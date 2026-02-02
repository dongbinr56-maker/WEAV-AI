from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from apps.chats.models import Session, Message, Job, SESSION_KIND_CHAT, SESSION_KIND_IMAGE
from apps.chats.serializers import MessageSerializer, ImageRecordSerializer
from .schemas import TextGenerationRequest, ImageGenerationRequest
from .router import IMAGE_MODEL_GOOGLE
from . import tasks


@api_view(['POST'])
def complete_chat(request):
    try:
        body = TextGenerationRequest(**request.data)
    except Exception as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    session_id = request.data.get('session_id')
    if not session_id:
        return Response({'detail': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
    session = get_object_or_404(Session, pk=session_id)
    if session.kind != SESSION_KIND_CHAT:
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
        model=body.model or 'google/gemini-2.5-flash',
        system_prompt=body.system_prompt,
    )
    job.task_id = task.id
    job.save(update_fields=['task_id'])
    return Response({
        'task_id': task.id,
        'job_id': job.id,
        'message_id': user_msg.id,
    }, status=status.HTTP_202_ACCEPTED)


@api_view(['POST'])
def complete_image(request):
    try:
        body = ImageGenerationRequest(**request.data)
    except Exception as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    session_id = request.data.get('session_id')
    if not session_id:
        return Response({'detail': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
    session = get_object_or_404(Session, pk=session_id)
    if session.kind != SESSION_KIND_IMAGE:
        return Response({'detail': 'Not an image session'}, status=status.HTTP_400_BAD_REQUEST)
    if Job.objects.filter(session_id=session.pk, kind='image').count() == 0:
        new_title = (body.prompt.strip() or session.title)[:255]
        session.title = new_title
        session.save(update_fields=['title', 'updated_at'])
    job = Job.objects.create(session=session, kind='image', status='pending')
    task = tasks.task_image.delay(
        job.id,
        prompt=body.prompt,
        model=body.model or IMAGE_MODEL_GOOGLE,
        aspect_ratio=body.aspect_ratio,
        num_images=body.num_images,
    )
    job.task_id = task.id
    job.save(update_fields=['task_id'])
    return Response({
        'task_id': task.id,
        'job_id': job.id,
    }, status=status.HTTP_202_ACCEPTED)


@api_view(['POST'])
def regenerate_chat(request):
    session_id = request.data.get('session_id')
    if not session_id:
        return Response({'detail': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
    session = get_object_or_404(Session, pk=session_id)
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
    last_user.delete()
    last_assistant.delete()
    user_msg = Message.objects.create(session=session, role='user', content=prompt)
    job = Job.objects.create(session=session, kind='chat', status='pending')
    task = tasks.task_chat.delay(
        job.id,
        prompt=prompt,
        model=model,
        system_prompt=system_prompt,
    )
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
    session = get_object_or_404(Session, pk=session_id)
    if session.kind != SESSION_KIND_IMAGE:
        return Response({'detail': 'Not an image session'}, status=status.HTTP_400_BAD_REQUEST)
    last_record = session.image_records.order_by('-created_at').first()
    if not last_record:
        return Response({'detail': 'No image to regenerate'}, status=status.HTTP_400_BAD_REQUEST)
    prompt = last_record.prompt
    model = last_record.model
    last_record.delete()
    job = Job.objects.create(session=session, kind='image', status='pending')
    task = tasks.task_image.delay(
        job.id,
        prompt=prompt,
        model=model,
        aspect_ratio=request.data.get('aspect_ratio') or '1:1',
        num_images=1,
    )
    job.task_id = task.id
    job.save(update_fields=['task_id'])
    return Response({
        'task_id': task.id,
        'job_id': job.id,
    }, status=status.HTTP_202_ACCEPTED)


@api_view(['POST'])
def job_cancel(request, task_id):
    from celery import current_app
    current_app.control.revoke(task_id, terminate=True)
    return Response({'status': 'cancelled'}, status=status.HTTP_200_OK)


@api_view(['GET'])
def job_status(request, task_id):
    job = get_object_or_404(Job, task_id=task_id)
    payload = {'task_id': task_id, 'job_id': job.id, 'status': job.status}
    if job.status == 'success':
        if job.message_id:
            payload['message'] = MessageSerializer(job.message).data
        if job.image_record_id:
            payload['image'] = ImageRecordSerializer(job.image_record).data
    if job.status == 'failure':
        payload['error'] = job.error_message
    return Response(payload)
