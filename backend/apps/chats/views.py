import logging
import os
import uuid
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from .models import Session, Message, ImageRecord, Document, SESSION_KIND_CHAT, SESSION_KIND_IMAGE, SESSION_KIND_STUDIO
from .serializers import SessionListSerializer, SessionDetailSerializer, MessageSerializer, ImageRecordSerializer
from .tasks import process_pdf_document

try:
    from storage.s3 import minio_client
except ImportError:
    minio_client = None

logger = logging.getLogger(__name__)

@api_view(['GET', 'POST'])
def session_list(request):
    # In a real app, we should filter by request.user
    # if request.user.is_authenticated:
    #    qs = Session.objects.filter(user=request.user)
    # else: qs = ...
    
    if request.method == 'GET':
        kind = request.query_params.get('kind')
        qs = Session.objects.all()
        if request.user.is_authenticated:
             qs = qs.filter(user=request.user)
             
        if kind in (SESSION_KIND_CHAT, SESSION_KIND_IMAGE, SESSION_KIND_STUDIO):
            qs = qs.filter(kind=kind)
        serializer = SessionListSerializer(qs, many=True)
        return Response(serializer.data)
        
    kind = request.data.get('kind', SESSION_KIND_CHAT)
    title = request.data.get('title', '')[:255]
    if kind not in (SESSION_KIND_CHAT, SESSION_KIND_IMAGE, SESSION_KIND_STUDIO):
        kind = SESSION_KIND_CHAT
    
    user = request.user if request.user.is_authenticated else None
    session = Session.objects.create(kind=kind, title=title or f'{kind} session', user=user)
    return Response(SessionListSerializer(session).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
def session_detail(request, session_id):
    try:
        session = Session.objects.get(pk=session_id)
        # Verify ownership
        if session.user and request.user.is_authenticated and session.user != request.user:
             return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
    except Session.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'GET':
        return Response(SessionDetailSerializer(session).data)
    if request.method == 'PATCH':
        title = request.data.get('title')
        if title is not None:
            session.title = str(title)[:255]
            session.save(update_fields=['title', 'updated_at'])
        return Response(SessionListSerializer(session).data)
    if request.method == 'DELETE':
        session.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)


@api_view(['GET'])
def session_messages(request, session_id):
    try:
        session = Session.objects.get(pk=session_id)
        if session.user and request.user.is_authenticated and session.user != request.user:
             return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
    except Session.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    if session.kind != SESSION_KIND_CHAT:
        return Response({'detail': 'Not a chat session'}, status=status.HTTP_400_BAD_REQUEST)
    serializer = MessageSerializer(session.messages.all(), many=True)
    return Response(serializer.data)


@api_view(['GET'])
def session_images(request, session_id):
    try:
        session = Session.objects.get(pk=session_id)
        if session.user and request.user.is_authenticated and session.user != request.user:
             return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
    except Session.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    if session.kind != SESSION_KIND_IMAGE:
        return Response({'detail': 'Not an image session'}, status=status.HTTP_400_BAD_REQUEST)
    serializer = ImageRecordSerializer(session.image_records.all(), many=True)
    return Response(serializer.data)


@api_view(['POST'])
def session_upload(request, session_id):
    logger.info(f"Upload request for session {session_id}")
    try:
        session = Session.objects.get(pk=session_id)
        if session.user and request.user.is_authenticated and session.user != request.user:
             return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
    except Session.DoesNotExist:
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    
    file_obj = request.FILES.get('file')
    if not file_obj:
        return Response({'detail': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)
    
    if not minio_client:
        return Response({'detail': 'Storage service unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    # Generate unique filename/key
    ext = os.path.splitext(file_obj.name)[1]
    # Structure: user_id/session_id/uuid.ext or session_id/uuid.ext
    key = f"{session_id}/{uuid.uuid4()}{ext}"
    
    try:
        # Upload
        logger.info(f"Uploading file {key} to MinIO")
        file_url = minio_client.upload_file(file_obj, key)
        
        # Create Document Record
        doc = Document.objects.create(
            session=session,
            file_name=key, # Storing the key in file_name for now as per task logic
            file_url=file_url,
            status=Document.STATUS_PENDING
        )
        
        # Trigger Task
        logger.info(f"Triggering process_pdf_document task for doc {doc.id}")
        process_pdf_document.delay(doc.id)
        
        return Response({
            'detail': 'File uploaded and processing started', 
            'document_id': doc.id,
            'file_url': file_url,
            'status': doc.status
        }, status=status.HTTP_202_ACCEPTED)
        
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
