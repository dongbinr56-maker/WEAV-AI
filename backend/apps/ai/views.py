import logging
import uuid
from pathlib import Path

from django.http import Http404
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.chats.models import Session, Message, Job, SESSION_KIND_CHAT, SESSION_KIND_IMAGE
from apps.chats.serializers import MessageSerializer, ImageRecordSerializer
from storage.s3 import minio_client
from .schemas import TextGenerationRequest, ImageGenerationRequest
from .router import (
    normalize_chat_model,
    IMAGE_MODEL_GOOGLE,
    IMAGE_MODEL_FLUX,
    IMAGE_MODEL_KLING,
    IMAGE_MODEL_GEMINI3_PRO_IMAGE,
    IMAGE_MODEL_NANO_BANANA,
)
from . import tasks


def _permission_denied_response():
    return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)


def _user_owns_resource(request, owner) -> bool:
    if owner is None:
        return True
    if not request.user.is_authenticated:
        return False
    return owner == request.user


def _get_accessible_session(request, session_id):
    session = get_object_or_404(Session, pk=session_id)
    if not _user_owns_resource(request, session.user):
        return None, _permission_denied_response()
    return session, None


def _get_accessible_job(request, task_id):
    job = get_object_or_404(Job, task_id=task_id)
    if not _user_owns_resource(request, job.session.user):
        return None, _permission_denied_response()
    return job, None


@api_view(['POST'])
def complete_chat(request):
    try:
        body = TextGenerationRequest(**request.data)
    except Exception as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    session_id = request.data.get('session_id')
    if not session_id:
        return Response({'detail': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        session, denied = _get_accessible_session(request, session_id)
        if denied:
            return denied
        if session.kind not in (SESSION_KIND_CHAT, SESSION_KIND_IMAGE):
            return Response({'detail': 'Not a chat session'}, status=status.HTTP_400_BAD_REQUEST)
        user_msg = Message.objects.create(session=session, role='user', content=body.prompt)
        if Message.objects.filter(session_id=session.pk).count() == 1:
            new_title = (body.prompt.strip() or session.title)[:255]
            session.title = new_title
            session.save(update_fields=['title', 'updated_at'])
        job = Job.objects.create(session=session, kind='chat', status='pending')
        task = tasks.task_chat.delay(
            job.id,
            prompt=body.prompt,
            model=normalize_chat_model(body.model),
            system_prompt=body.system_prompt,
        )
        job.task_id = task.id
        job.save(update_fields=['task_id'])
        return Response({
            'task_id': task.id,
            'job_id': job.id,
            'message_id': user_msg.id,
        }, status=status.HTTP_202_ACCEPTED)
    except Http404:
        raise
    except Exception as e:
        logging.getLogger(__name__).exception("complete_chat error")
        return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def complete_image(request):
    try:
        body = ImageGenerationRequest(**request.data)
    except Exception as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    session_id = request.data.get('session_id')
    if not session_id:
        return Response({'detail': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied
    if session.kind not in (SESSION_KIND_IMAGE, SESSION_KIND_CHAT):
        return Response({'detail': 'Not an image session'}, status=status.HTTP_400_BAD_REQUEST)
    if Job.objects.filter(session_id=session.pk, kind='image').count() == 0:
        new_title = (body.prompt.strip() or session.title)[:255]
        session.title = new_title
        session.save(update_fields=['title', 'updated_at'])
    image_urls = body.image_urls or []
    image_urls = [u for u in image_urls if isinstance(u, str) and u.strip()]
    # 세션 참고 이미지: 요청 body에 실려 오면 우선 사용, 없으면 세션 DB에서 로드 (body로 보내야 edit 경로 확실히 사용)
    body_ref_urls = getattr(body, 'reference_image_urls', None) or []
    body_ref_urls = [u for u in body_ref_urls if isinstance(u, str) and u.strip()][:2]
    session_ref_urls = body_ref_urls or (getattr(session, 'reference_image_urls', None) or [])
    if not isinstance(session_ref_urls, list):
        session_ref_urls = []
    session_ref_urls = [u for u in session_ref_urls if isinstance(u, str) and u.strip()][:2]
    has_request_ref = bool(body.reference_image_id or body.reference_image_url)
    has_reference = has_request_ref or bool(session_ref_urls)
    model = body.model or IMAGE_MODEL_GOOGLE

    if image_urls:
        if model in (IMAGE_MODEL_GOOGLE, IMAGE_MODEL_FLUX, IMAGE_MODEL_GEMINI3_PRO_IMAGE):
            return Response(
                {'detail': '이 모델은 이미지 첨부를 지원하지 않습니다. Nano Banana 또는 Kling을 사용하세요.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if model == IMAGE_MODEL_KLING:
            if has_reference:
                return Response(
                    {'detail': 'Kling은 참조 이미지 사용 시 추가 첨부를 지원하지 않습니다. Nano Banana를 사용하세요.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(image_urls) > 1:
                return Response(
                    {'detail': 'Kling은 이미지 첨부를 1개까지만 지원합니다. Nano Banana를 사용하세요.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        if model == IMAGE_MODEL_NANO_BANANA:
            max_allowed = 1 if has_reference else 2
            if len(image_urls) > max_allowed:
                return Response(
                    {'detail': f'Nano Banana는 이미지 첨부를 최대 {max_allowed}개까지 지원합니다.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

    job = Job.objects.create(session=session, kind='image', status='pending')
    # 요청에서 참조를 보냈으면 기존처럼 단일 참조+첨부, 없으면 세션 참고 이미지 목록 전달
    task = tasks.task_image.delay(
        job.id,
        prompt=body.prompt,
        model=model,
        aspect_ratio=body.aspect_ratio,
        num_images=body.num_images,
        reference_image_id=body.reference_image_id if has_request_ref else None,
        reference_image_url=body.reference_image_url if has_request_ref else None,
        reference_image_urls=session_ref_urls if not has_request_ref and session_ref_urls else None,
        image_urls=image_urls,
        resolution=body.resolution,
        output_format=body.output_format,
        seed=body.seed,
    )
    job.task_id = task.id
    job.save(update_fields=['task_id'])
    return Response({
        'task_id': task.id,
        'job_id': job.id,
    }, status=status.HTTP_202_ACCEPTED)


ALLOWED_REFERENCE_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
MAX_REFERENCE_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB


@api_view(['POST'])
def upload_reference_image(request):
    """참조 이미지 업로드. multipart file 'image' 전달. 반환: { url: 공개 URL }"""
    if 'image' not in request.FILES:
        return Response({'detail': 'image file required'}, status=status.HTTP_400_BAD_REQUEST)
    f = request.FILES['image']
    if f.content_type not in ALLOWED_REFERENCE_IMAGE_TYPES:
        return Response(
            {'detail': f'Allowed types: {", ".join(ALLOWED_REFERENCE_IMAGE_TYPES)}'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if f.size > MAX_REFERENCE_IMAGE_SIZE:
        return Response({'detail': 'File too large (max 10MB)'}, status=status.HTTP_400_BAD_REQUEST)
    ext = Path(f.name).suffix or '.png'
    if ext.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
        ext = '.png'
    name = f"{uuid.uuid4().hex}{ext}"
    key = f"ref_uploads/{name}"
    try:
        f.seek(0)
    except Exception:
        pass
    url = minio_client.upload_file(f.file, key, content_type=f.content_type)
    return Response({'url': url}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def upload_attachment_images(request):
    """첨부 이미지 업로드. multipart file 'images' (1~2개). 반환: { urls: [..] }"""
    files = request.FILES.getlist('images')
    if not files:
        return Response({'detail': 'images files required'}, status=status.HTTP_400_BAD_REQUEST)
    if len(files) > 2:
        return Response({'detail': '이미지는 최대 2개까지 업로드할 수 있습니다.'}, status=status.HTTP_400_BAD_REQUEST)

    urls = []
    for f in files:
        if f.content_type not in ALLOWED_REFERENCE_IMAGE_TYPES:
            return Response(
                {'detail': f'Allowed types: {", ".join(ALLOWED_REFERENCE_IMAGE_TYPES)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if f.size > MAX_REFERENCE_IMAGE_SIZE:
            return Response({'detail': 'File too large (max 10MB)'}, status=status.HTTP_400_BAD_REQUEST)
        ext = Path(f.name).suffix or '.png'
        if ext.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
            ext = '.png'
        name = f"{uuid.uuid4().hex}{ext}"
        key = f"attach_uploads/{name}"
        try:
            f.seek(0)
        except Exception:
            pass
        url = minio_client.upload_file(f.file, key, content_type=f.content_type)
        urls.append(url)

    return Response({'urls': urls}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def regenerate_chat(request):
    session_id = request.data.get('session_id')
    if not session_id:
        return Response({'detail': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied
    if session.kind != SESSION_KIND_CHAT:
        return Response({'detail': 'Not a chat session'}, status=status.HTTP_400_BAD_REQUEST)
    messages = list(session.messages.order_by('created_at'))
    if len(messages) < 2:
        return Response({'detail': 'Need at least one user and one assistant message'}, status=status.HTTP_400_BAD_REQUEST)
    last_user = messages[-2]
    last_assistant = messages[-1]
    if last_user.role != 'user' or last_assistant.role != 'assistant':
        return Response({'detail': 'Last two messages must be user and assistant'}, status=status.HTTP_400_BAD_REQUEST)
    prompt = request.data.get('prompt')
    if prompt is None or (isinstance(prompt, str) and not prompt.strip()):
        prompt = last_user.content
    else:
        prompt = str(prompt).strip()[:10000]
    model = request.data.get('model') or 'google/gemini-2.5-flash'
    system_prompt = request.data.get('system_prompt')
    job = Job.objects.create(session=session, kind='chat', status='pending')
    try:
        task = tasks.task_chat.delay(
            job.id,
            prompt=prompt,
            model=normalize_chat_model(model),
            system_prompt=system_prompt,
        )
    except Exception as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        logging.getLogger(__name__).exception("regenerate_chat queue error")
        return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    with transaction.atomic():
        last_user.delete()
        last_assistant.delete()
        user_msg = Message.objects.create(session=session, role='user', content=prompt)
        job.task_id = task.id
        job.save(update_fields=['task_id'])
    return Response({
        'task_id': task.id,
        'job_id': job.id,
        'message_id': user_msg.id,
    }, status=status.HTTP_202_ACCEPTED)


@api_view(['POST'])
def regenerate_image(request):
    session_id = request.data.get('session_id')
    if not session_id:
        return Response({'detail': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied
    if session.kind not in (SESSION_KIND_IMAGE, SESSION_KIND_CHAT):
        return Response({'detail': 'Not an image session'}, status=status.HTTP_400_BAD_REQUEST)
    last_record = session.image_records.order_by('-created_at').first()
    if not last_record:
        return Response({'detail': 'No image to regenerate'}, status=status.HTTP_400_BAD_REQUEST)
    prompt = request.data.get('prompt')
    if prompt is None or (isinstance(prompt, str) and not prompt.strip()):
        prompt = last_record.prompt
    else:
        prompt = str(prompt).strip()[:10000]
    model = request.data.get('model') or last_record.model
    image_urls = request.data.get('image_urls') or []
    image_urls = [u for u in image_urls if isinstance(u, str) and u.strip()]
    body_ref_urls = request.data.get('reference_image_urls') or []
    body_ref_urls = [u for u in body_ref_urls if isinstance(u, str) and u.strip()][:2]
    job = Job.objects.create(session=session, kind='image', status='pending')
    try:
        task = tasks.task_image.delay(
            job.id,
            prompt=prompt,
            base_prompt=last_record.prompt,
            model=model,
            aspect_ratio=request.data.get('aspect_ratio') or '1:1',
            num_images=1,
            reference_image_id=request.data.get('reference_image_id'),
            reference_image_url=request.data.get('reference_image_url'),
            reference_image_urls=body_ref_urls or None,
            image_urls=image_urls,
            resolution=request.data.get('resolution'),
            output_format=request.data.get('output_format'),
            seed=request.data.get('seed'),
        )
    except Exception as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        logging.getLogger(__name__).exception("regenerate_image queue error")
        return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    with transaction.atomic():
        last_record.delete()
        job.task_id = task.id
        job.save(update_fields=['task_id'])
    return Response({
        'task_id': task.id,
        'job_id': job.id,
    }, status=status.HTTP_202_ACCEPTED)


@api_view(['POST'])
def job_cancel(request, task_id):
    job, denied = _get_accessible_job(request, task_id)
    if denied:
        return denied
    from celery import current_app
    if job.task_id:
        current_app.control.revoke(job.task_id, terminate=True)
    if job.status not in ('success', 'failure'):
        job.status = 'failure'
        job.error_message = 'cancelled'
        job.result = {}
        job.save(update_fields=['status', 'error_message', 'result', 'updated_at'])
    return Response({'status': 'cancelled'}, status=status.HTTP_200_OK)


@api_view(['GET'])
def job_status(request, task_id):
    job, denied = _get_accessible_job(request, task_id)
    if denied:
        return denied
    payload = {'task_id': task_id, 'job_id': job.id, 'status': job.status, 'kind': job.kind, 'result': job.result or {}}
    if job.status == 'success':
        if job.message_id:
            payload['message'] = MessageSerializer(job.message).data
        if job.image_record_id:
            payload['image'] = ImageRecordSerializer(job.image_record).data
    if job.status == 'failure':
        payload['error'] = job.error_message
    return Response(payload)
