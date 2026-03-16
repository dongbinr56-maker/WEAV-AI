import logging
import os
import uuid

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.http import HttpResponse

from .models import Session, Message, ImageRecord, Document, ChatMemory, SESSION_KIND_CHAT, SESSION_KIND_IMAGE, SESSION_KIND_STUDIO
from .serializers import SessionListSerializer, SessionDetailSerializer, MessageSerializer, ImageRecordSerializer, DocumentSerializer
from .tasks import process_pdf_document

try:
    from storage.s3 import minio_client
except ImportError:
    minio_client = None

logger = logging.getLogger(__name__)


def _permission_denied_response():
    return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)


def _user_owns_session(request, owner) -> bool:
    if owner is None:
        return True
    if not request.user.is_authenticated:
        return False
    return owner == request.user


def _accessible_sessions_qs(request):
    qs = Session.objects.all()
    if request.user.is_authenticated:
        return qs.filter(user=request.user)
    return qs.filter(user__isnull=True)


def _get_accessible_session(request, session_id):
    try:
        session = Session.objects.get(pk=session_id)
    except Session.DoesNotExist:
        return None, Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    if not _user_owns_session(request, session.user):
        return None, _permission_denied_response()
    return session, None


@api_view(['GET', 'POST'])
def session_list(request):
    if request.method == 'GET':
        kind = request.query_params.get('kind')
        qs = _accessible_sessions_qs(request)
        if kind in (SESSION_KIND_CHAT, SESSION_KIND_IMAGE, SESSION_KIND_STUDIO):
            qs = qs.filter(kind=kind)
        serializer = SessionListSerializer(qs, many=True)
        return Response(serializer.data)

    # POST: create session (전체 예외 잡아 JSON으로 반환)
    try:
        kind = request.data.get('kind', SESSION_KIND_CHAT)
        title = (request.data.get('title') or '')[:255]
        if kind not in (SESSION_KIND_CHAT, SESSION_KIND_IMAGE, SESSION_KIND_STUDIO):
            kind = SESSION_KIND_CHAT
        user = request.user if request.user.is_authenticated else None
        session = Session.objects.create(
            kind=kind,
            title=title or f'{kind} session',
            user=user,
        )
        data = SessionDetailSerializer(session).data
        return Response(data, status=status.HTTP_201_CREATED)
    except Exception as e:
        logger.exception("Session create/serialize failed: %s", e)
        return Response(
            {'detail': f'세션 생성 실패: {str(e)}. 프로젝트 루트에서 make migrate 실행 후 재시도.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['GET', 'PATCH', 'DELETE'])
def session_detail(request, session_id):
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied
        
    if request.method == 'GET':
        return Response(SessionDetailSerializer(session).data)
    if request.method == 'PATCH':
        updated = []
        title = request.data.get('title')
        if title is not None:
            session.title = str(title)[:255]
            updated.extend(['title', 'updated_at'])
        ref_urls = request.data.get('reference_image_urls')
        if ref_urls is not None and session.kind == SESSION_KIND_IMAGE:
            if not isinstance(ref_urls, list):
                return Response({'detail': 'reference_image_urls must be a list'}, status=status.HTTP_400_BAD_REQUEST)
            urls = [u for u in ref_urls if isinstance(u, str) and u.strip()][:2]
            session.reference_image_urls = urls
            updated.extend(['reference_image_urls', 'updated_at'])
        if updated:
            session.save(update_fields=list(dict.fromkeys(updated)))
        return Response(SessionListSerializer(session).data)
    if request.method == 'DELETE':
        Session.objects.filter(pk=session.id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)


@api_view(['POST'])
def session_bulk_delete(request):
    """
    Bulk delete sessions with a single request to avoid proxy rate limits.
    Body: { "ids": [1, 2, 3] } (or a raw JSON list)
    """
    raw = request.data
    ids = raw.get('ids') if isinstance(raw, dict) else raw
    if not isinstance(ids, list):
        return Response({'detail': 'ids must be a list'}, status=status.HTTP_400_BAD_REQUEST)

    normalized = []
    seen = set()
    for v in ids:
        try:
            i = int(v)
        except (TypeError, ValueError):
            continue
        if i <= 0 or i in seen:
            continue
        seen.add(i)
        normalized.append(i)

    if not normalized:
        return Response({'deleted': 0, 'not_found': [], 'forbidden': []}, status=status.HTTP_200_OK)

    qs = Session.objects.filter(pk__in=normalized)
    found = {s.id: s for s in qs}
    not_found = [i for i in normalized if i not in found]

    forbidden = []
    deletable = []
    for sid, s in found.items():
        if not _user_owns_session(request, s.user):
            forbidden.append(sid)
        else:
            deletable.append(sid)

    if deletable:
        Session.objects.filter(pk__in=deletable).delete()

    return Response(
        {'deleted': len(deletable), 'not_found': not_found, 'forbidden': forbidden},
        status=status.HTTP_200_OK,
    )


@api_view(['GET'])
def session_messages(request, session_id):
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied
    if session.kind != SESSION_KIND_CHAT:
        return Response({'detail': 'Not a chat session'}, status=status.HTTP_400_BAD_REQUEST)
    serializer = MessageSerializer(session.messages.all(), many=True)
    return Response(serializer.data)


@api_view(['GET'])
def session_images(request, session_id):
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied
    if session.kind != SESSION_KIND_IMAGE:
        return Response({'detail': 'Not an image session'}, status=status.HTTP_400_BAD_REQUEST)
    serializer = ImageRecordSerializer(session.image_records.all(), many=True)
    return Response(serializer.data)


@api_view(['POST'])
def session_upload(request, session_id):
    logger.info(f"Upload request for session {session_id}")
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied
    
    file_obj = request.FILES.get('file')
    if not file_obj:
        return Response({'detail': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)
    
    if not minio_client:
        return Response({'detail': 'Storage service unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    allowed_content_types = {
        'application/pdf',
        'application/x-pdf',
        'application/x-hwp',
        'application/haansofthwp',
        'application/vnd.hancom.hwp',
        'application/vnd.hancom.hwpx',
        'application/octet-stream',
    }
    allowed_exts = ('.pdf', '.hwp', '.hwpx')
    if file_obj.content_type not in allowed_content_types:
        # Fallback to extension check
        if not file_obj.name.lower().endswith(allowed_exts):
            return Response({'detail': 'Only PDF/HWP/HWPX files are supported'}, status=status.HTTP_400_BAD_REQUEST)

    # Generate unique filename/key
    ext = os.path.splitext(file_obj.name)[1]
    # Structure: user_id/session_id/uuid.ext or session_id/uuid.ext
    key = f"{session_id}/{uuid.uuid4()}{ext}"
    
    try:
        # Upload
        logger.info(f"Uploading file {key} to MinIO")
        content_type = file_obj.content_type or 'application/octet-stream'
        file_url = minio_client.upload_file(file_obj, key, content_type=content_type)
        
        # Create Document Record
        doc = Document.objects.create(
            session=session,
            file_name=key, # Storing the key in file_name for now as per task logic
            original_name=os.path.basename(file_obj.name),
            file_url=file_url,
            status=Document.STATUS_PENDING
        )
        
        # Trigger Task
        logger.info(f"Triggering process_pdf_document task for doc {doc.id}")
        process_pdf_document.delay(doc.id)
        
        return Response({
            'detail': 'File uploaded and processing started', 
            'document_id': doc.id,
            'original_name': doc.original_name,
            'file_url': request.build_absolute_uri(f"/api/v1/sessions/{session_id}/documents/{doc.id}/file/"),
            'status': doc.status
        }, status=status.HTTP_202_ACCEPTED)
        
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def session_documents(request, session_id):
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied

    docs = session.documents.all()
    serializer = DocumentSerializer(docs, many=True, context={'request': request})
    return Response(serializer.data)


@api_view(['GET'])
def session_document_file(request, session_id, document_id):
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied

    try:
        doc = Document.objects.get(pk=document_id, session_id=session_id)
    except Document.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    if not minio_client:
        return Response({'detail': 'Storage service unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    file_key = doc.pdf_file_name or doc.file_name
    try:
        content = minio_client.get_file_content(file_key)
    except Exception as e:
        return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    filename = doc.original_name or doc.file_name
    if doc.pdf_file_name:
        base = os.path.splitext(filename)[0]
        filename = f"{base}.pdf"
    response = HttpResponse(content, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{filename}"'
    return response


@api_view(['DELETE'])
def session_document_delete(request, session_id, document_id):
    session, denied = _get_accessible_session(request, session_id)
    if denied:
        return denied

    try:
        doc = Document.objects.get(pk=document_id, session_id=session_id)
    except Document.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    # Delete stored files
    if minio_client:
        keys = {doc.file_name}
        if doc.pdf_file_name:
            keys.add(doc.pdf_file_name)
        for key in keys:
            try:
                minio_client.delete_file(key)
            except Exception:
                logger.warning(f"Failed to delete file key from MinIO: {key}")

    # Remove related vector memory
    try:
        ChatMemory.objects.filter(session_id=session_id, metadata__document_id=document_id).delete()
    except Exception as e:
        logger.warning(f"Failed to delete memories for doc {document_id}: {e}")

    doc.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
