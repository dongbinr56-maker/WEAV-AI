"""
세션 API 테스트.
Docker 환경에서만 실행합니다.
"""
import os
from unittest.mock import ANY, MagicMock, patch
from django.core.files.uploadedfile import SimpleUploadedFile
from django.contrib.auth import get_user_model
from django.test import TestCase, Client
from apps.chats.models import Session, Job, Message, ImageRecord, Document, SESSION_KIND_CHAT, SESSION_KIND_IMAGE
from apps.chats.tasks import process_pdf_document, update_document_progress


class SessionAPITests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_create_chat_session(self):
        response = self.client.post(
            '/api/v1/sessions/',
            data={'kind': SESSION_KIND_CHAT, 'title': '테스트 채팅'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data['kind'], SESSION_KIND_CHAT)
        self.assertEqual(data['title'], '테스트 채팅')
        self.assertIn('id', data)

    def test_create_image_session(self):
        response = self.client.post(
            '/api/v1/sessions/',
            data={'kind': SESSION_KIND_IMAGE},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data['kind'], SESSION_KIND_IMAGE)

    def test_list_sessions(self):
        Session.objects.create(kind=SESSION_KIND_CHAT, title='A')
        Session.objects.create(kind=SESSION_KIND_IMAGE, title='B')
        response = self.client.get('/api/v1/sessions/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2)

    def test_list_sessions_filter_by_kind(self):
        Session.objects.create(kind=SESSION_KIND_CHAT, title='A')
        Session.objects.create(kind=SESSION_KIND_IMAGE, title='B')
        response = self.client.get('/api/v1/sessions/?kind=chat')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['kind'], SESSION_KIND_CHAT)

    def test_anonymous_list_excludes_owned_sessions(self):
        owner = get_user_model().objects.create_user(username='owner-list', password='testpass123')
        Session.objects.create(kind=SESSION_KIND_CHAT, title='공개 채팅')
        Session.objects.create(kind=SESSION_KIND_CHAT, title='비공개 채팅', user=owner)

        response = self.client.get('/api/v1/sessions/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['title'], '공개 채팅')


class ImageGenerationAPITests(TestCase):
    """이미지 생성 API 요청/검증 구조 테스트. fal 호출은 mock."""

    def setUp(self):
        self.client = Client()
        self.session = Session.objects.create(kind=SESSION_KIND_IMAGE, title='이미지 세션')

    def test_complete_image_requires_session_id(self):
        response = self.client.post(
            '/api/v1/chat/image/',
            data={'prompt': 'a cat'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('session_id', response.json().get('detail', ''))

    def test_complete_image_accepts_chat_session(self):
        """채팅 세션에서도 이미지 생성 요청이 가능해야 함 (단일 채팅방 통합 UX)."""
        chat_session = Session.objects.create(kind=SESSION_KIND_CHAT, title='채팅')
        with patch('apps.ai.tasks.task_image.delay') as mock_delay:
            mock_delay.return_value.id = 'mock-task-id'
            response = self.client.post(
                '/api/v1/chat/image/',
                data={
                    'session_id': chat_session.id,
                    'prompt': 'a cat',
                },
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 202)
        data = response.json()
        self.assertIn('task_id', data)
        self.assertIn('job_id', data)
        job = Job.objects.get(pk=data['job_id'])
        self.assertEqual(job.session_id, chat_session.id)
        self.assertEqual(job.kind, 'image')
        self.assertEqual(job.status, 'pending')

    def test_complete_image_accepts_valid_request_returns_202(self):
        with patch('apps.ai.tasks.task_image.delay') as mock_delay:
            mock_delay.return_value.id = 'mock-task-id'
            response = self.client.post(
                '/api/v1/chat/image/',
                data={
                    'session_id': self.session.id,
                    'prompt': 'a red apple',
                },
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 202)
        data = response.json()
        self.assertIn('task_id', data)
        self.assertIn('job_id', data)
        job = Job.objects.get(pk=data['job_id'])
        self.assertEqual(job.session_id, self.session.id)
        self.assertEqual(job.kind, 'image')
        self.assertEqual(job.status, 'pending')

    def test_complete_image_validates_model_and_attachments(self):
        """이미지 첨부 시 Imagen/FLUX 등 비지원 모델이면 400."""
        with patch('apps.ai.tasks.task_image.delay'):
            response = self.client.post(
                '/api/v1/chat/image/',
                data={
                    'session_id': self.session.id,
                    'prompt': 'edit this',
                    'model': 'fal-ai/imagen4/preview',
                    'image_urls': ['https://example.com/img.png'],
                },
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn('이 모델은 이미지 첨부를 지원하지 않습니다', response.json().get('detail', ''))


class ChatPermissionAPITests(TestCase):
    def setUp(self):
        self.client = Client()
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(username='owner', password='testpass123')
        self.other = user_model.objects.create_user(username='other', password='testpass123')
        self.chat_session = Session.objects.create(kind=SESSION_KIND_CHAT, title='보호된 채팅', user=self.owner)
        self.image_session = Session.objects.create(kind=SESSION_KIND_IMAGE, title='보호된 이미지', user=self.owner)

    def test_complete_chat_forbidden_for_other_user(self):
        self.client.force_login(self.other)
        response = self.client.post(
            '/api/v1/chat/complete/',
            data={'session_id': self.chat_session.id, 'prompt': '안녕', 'model': 'google/gemini-2.5-flash'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json().get('detail'), 'Permission denied')

    def test_complete_image_forbidden_for_anonymous_user_on_owned_session(self):
        response = self.client.post(
            '/api/v1/chat/image/',
            data={'session_id': self.image_session.id, 'prompt': 'a cat'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json().get('detail'), 'Permission denied')

    def test_session_detail_forbidden_for_anonymous_user_on_owned_session(self):
        response = self.client.get(f'/api/v1/sessions/{self.chat_session.id}/')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json().get('detail'), 'Permission denied')

    def test_session_delete_forbidden_for_anonymous_user_on_owned_session(self):
        response = self.client.delete(f'/api/v1/sessions/{self.chat_session.id}/')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json().get('detail'), 'Permission denied')
        self.assertTrue(Session.objects.filter(pk=self.chat_session.id).exists())

    def test_session_bulk_delete_forbidden_for_anonymous_user_on_owned_session(self):
        response = self.client.post(
            '/api/v1/sessions/bulk-delete/',
            data={'ids': [self.chat_session.id]},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get('deleted'), 0)
        self.assertEqual(response.json().get('forbidden'), [self.chat_session.id])
        self.assertTrue(Session.objects.filter(pk=self.chat_session.id).exists())

    def test_job_endpoints_forbidden_for_other_user(self):
        job = Job.objects.create(
            session=self.chat_session,
            kind='chat',
            status='pending',
            task_id='protected-task-id',
        )
        Message.objects.create(session=self.chat_session, role='user', content='테스트')

        self.client.force_login(self.other)

        status_response = self.client.get(f'/api/v1/chat/job/{job.task_id}/')
        self.assertEqual(status_response.status_code, 403)
        self.assertEqual(status_response.json().get('detail'), 'Permission denied')

        with patch('celery.current_app.control.revoke') as mock_revoke:
            cancel_response = self.client.post(f'/api/v1/chat/job/{job.task_id}/cancel/')
        self.assertEqual(cancel_response.status_code, 403)
        self.assertEqual(cancel_response.json().get('detail'), 'Permission denied')
        mock_revoke.assert_not_called()

    def test_job_cancel_updates_job_status_when_revoked(self):
        job = Job.objects.create(
            session=self.chat_session,
            kind='chat',
            status='running',
            task_id='running-task-id',
            result={'step': 'working'},
        )
        self.client.force_login(self.owner)

        with patch('celery.current_app.control.revoke') as mock_revoke:
            response = self.client.post(f'/api/v1/chat/job/{job.task_id}/cancel/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get('status'), 'cancelled')
        mock_revoke.assert_called_once_with(job.task_id, terminate=True)

        job.refresh_from_db()
        self.assertEqual(job.status, 'failure')
        self.assertEqual(job.error_message, 'cancelled')
        self.assertEqual(job.result, {})


class ChatCompletionAPITests(TestCase):
    def setUp(self):
        self.client = Client()
        self.session = Session.objects.create(kind=SESSION_KIND_CHAT, title='빈 채팅')

    def test_complete_chat_creates_message_job_and_updates_first_title(self):
        with patch('apps.ai.tasks.task_chat.delay') as mock_delay:
            mock_delay.return_value.id = 'chat-task-id'
            response = self.client.post(
                '/api/v1/chat/complete/',
                data={
                    'session_id': self.session.id,
                    'prompt': '첫 질문입니다',
                    'model': 'google/gemini-2.5-flash',
                },
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 202)
        data = response.json()

        self.session.refresh_from_db()
        self.assertEqual(self.session.title, '첫 질문입니다')

        user_msg = Message.objects.get(pk=data['message_id'])
        self.assertEqual(user_msg.session_id, self.session.id)
        self.assertEqual(user_msg.role, 'user')
        self.assertEqual(user_msg.content, '첫 질문입니다')

        job = Job.objects.get(pk=data['job_id'])
        self.assertEqual(job.session_id, self.session.id)
        self.assertEqual(job.kind, 'chat')
        self.assertEqual(job.task_id, 'chat-task-id')
        self.assertEqual(job.status, 'pending')

    def test_complete_chat_requires_session_id(self):
        response = self.client.post(
            '/api/v1/chat/complete/',
            data={'prompt': '안녕', 'model': 'google/gemini-2.5-flash'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('session_id', response.json().get('detail', ''))


class RegenerateAPITests(TestCase):
    def setUp(self):
        self.client = Client()
        self.session = Session.objects.create(kind=SESSION_KIND_CHAT, title='재생성 채팅')
        self.image_session = Session.objects.create(kind=SESSION_KIND_IMAGE, title='재생성 이미지')

    def test_regenerate_chat_preserves_messages_when_queue_fails(self):
        user_msg = Message.objects.create(session=self.session, role='user', content='첫 질문')
        assistant_msg = Message.objects.create(session=self.session, role='assistant', content='첫 답변')

        with patch('apps.ai.tasks.task_chat.delay', side_effect=RuntimeError('broker down')):
            response = self.client.post(
                '/api/v1/chat/regenerate/',
                data={'session_id': self.session.id},
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 500)
        self.assertTrue(Message.objects.filter(pk=user_msg.id).exists())
        self.assertTrue(Message.objects.filter(pk=assistant_msg.id).exists())
        self.assertEqual(Job.objects.filter(session=self.session, kind='chat').count(), 1)

        job = Job.objects.get(session=self.session, kind='chat')
        self.assertEqual(job.status, 'failure')
        self.assertEqual(job.error_message, 'broker down')

    def test_regenerate_chat_replaces_last_turn_after_queue_success(self):
        old_user = Message.objects.create(session=self.session, role='user', content='이전 질문')
        old_assistant = Message.objects.create(session=self.session, role='assistant', content='이전 답변')

        with patch('apps.ai.tasks.task_chat.delay') as mock_delay:
            mock_delay.return_value.id = 'regen-chat-task'
            response = self.client.post(
                '/api/v1/chat/regenerate/',
                data={'session_id': self.session.id, 'prompt': '새 질문'},
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 202)
        data = response.json()
        self.assertFalse(Message.objects.filter(pk=old_user.id).exists())
        self.assertFalse(Message.objects.filter(pk=old_assistant.id).exists())

        new_user = Message.objects.get(pk=data['message_id'])
        self.assertEqual(new_user.role, 'user')
        self.assertEqual(new_user.content, '새 질문')

        job = Job.objects.get(pk=data['job_id'])
        self.assertEqual(job.task_id, 'regen-chat-task')
        self.assertEqual(job.status, 'pending')

    def test_regenerate_image_preserves_record_when_queue_fails(self):
        record = ImageRecord.objects.create(
            session=self.image_session,
            prompt='old prompt',
            image_url='https://example.com/old.png',
            model='fal-ai/imagen4/preview',
        )

        with patch('apps.ai.tasks.task_image.delay', side_effect=RuntimeError('broker down')):
            response = self.client.post(
                '/api/v1/chat/image/regenerate/',
                data={'session_id': self.image_session.id},
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 500)
        self.assertTrue(ImageRecord.objects.filter(pk=record.id).exists())
        job = Job.objects.get(session=self.image_session, kind='image')
        self.assertEqual(job.status, 'failure')
        self.assertEqual(job.error_message, 'broker down')

    def test_regenerate_image_replaces_record_after_queue_success(self):
        record = ImageRecord.objects.create(
            session=self.image_session,
            prompt='old prompt',
            image_url='https://example.com/old.png',
            model='fal-ai/imagen4/preview',
        )

        with patch('apps.ai.tasks.task_image.delay') as mock_delay:
            mock_delay.return_value.id = 'regen-image-task'
            response = self.client.post(
                '/api/v1/chat/image/regenerate/',
                data={'session_id': self.image_session.id, 'prompt': 'new prompt'},
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 202)
        self.assertFalse(ImageRecord.objects.filter(pk=record.id).exists())
        job = Job.objects.get(pk=response.json()['job_id'])
        self.assertEqual(job.task_id, 'regen-image-task')
        self.assertEqual(job.status, 'pending')

    def test_regenerate_image_forwards_reference_fields(self):
        record = ImageRecord.objects.create(
            session=self.image_session,
            prompt='old prompt',
            image_url='https://example.com/old.png',
            model='fal-ai/nano-banana-pro',
        )
        reference = ImageRecord.objects.create(
            session=self.image_session,
            prompt='reference prompt',
            image_url='https://example.com/reference.png',
            model='fal-ai/nano-banana-pro',
        )

        with patch('apps.ai.tasks.task_image.delay') as mock_delay:
            mock_delay.return_value.id = 'regen-image-task'
            response = self.client.post(
                '/api/v1/chat/image/regenerate/',
                data={
                    'session_id': self.image_session.id,
                    'prompt': 'new prompt',
                    'reference_image_id': reference.id,
                    'image_urls': ['https://example.com/attach.png'],
                },
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 202)
        self.assertFalse(ImageRecord.objects.filter(pk=record.id).exists())
        mock_delay.assert_called_once_with(
            ANY,
            prompt='new prompt',
            model='fal-ai/nano-banana-pro',
            base_prompt='old prompt',
            aspect_ratio='1:1',
            num_images=1,
            reference_image_id=reference.id,
            reference_image_url=None,
            reference_image_urls=None,
            image_urls=['https://example.com/attach.png'],
            resolution=None,
            output_format=None,
            seed=None,
        )

    def test_regenerate_chat_requires_user_assistant_pair(self):
        Message.objects.create(session=self.session, role='user', content='첫 질문만 있음')

        response = self.client.post(
            '/api/v1/chat/regenerate/',
            data={'session_id': self.session.id},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('Need at least one user and one assistant message', response.json().get('detail', ''))

    def test_regenerate_image_requires_existing_record(self):
        response = self.client.post(
            '/api/v1/chat/image/regenerate/',
            data={'session_id': self.image_session.id},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('No image to regenerate', response.json().get('detail', ''))


class DocumentUploadAPITests(TestCase):
    def setUp(self):
        self.client = Client()
        self.session = Session.objects.create(kind=SESSION_KIND_CHAT, title='문서 세션')

    def test_session_upload_creates_document_and_queues_task(self):
        storage = MagicMock()
        storage.upload_file.return_value = 'http://example.com/uploaded.pdf'
        upload = SimpleUploadedFile('sample.pdf', b'%PDF-1.4 fake pdf', content_type='application/pdf')

        with patch('apps.chats.views.minio_client', storage), patch('apps.chats.views.process_pdf_document.delay') as mock_delay:
            response = self.client.post(f'/api/v1/sessions/{self.session.id}/upload/', data={'file': upload})

        self.assertEqual(response.status_code, 202)
        data = response.json()
        doc = Document.objects.get(pk=data['document_id'])
        self.assertEqual(doc.session_id, self.session.id)
        self.assertEqual(doc.original_name, 'sample.pdf')
        self.assertEqual(doc.status, Document.STATUS_PENDING)
        mock_delay.assert_called_once_with(doc.id)

    def test_session_documents_includes_progress_fields(self):
        doc = Document.objects.create(
            session=self.session,
            file_name='1/sample.pdf',
            original_name='sample.pdf',
            file_url='http://example.com/sample.pdf',
            status=Document.STATUS_PROCESSING,
            total_pages=12,
            processed_pages=3,
            progress_label='3 / 12 페이지 텍스트 추출 중',
        )

        response = self.client.get(f'/api/v1/sessions/{self.session.id}/documents/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['id'], doc.id)
        self.assertEqual(data[0]['total_pages'], 12)
        self.assertEqual(data[0]['processed_pages'], 3)
        self.assertEqual(data[0]['progress_label'], '3 / 12 페이지 텍스트 추출 중')

    def test_session_document_delete_keeps_session_accessible_and_clears_documents(self):
        doc = Document.objects.create(
            session=self.session,
            file_name='1/sample.pdf',
            original_name='sample.pdf',
            file_url='http://example.com/sample.pdf',
            status=Document.STATUS_COMPLETED,
        )

        with patch('apps.chats.views.minio_client') as mock_storage, \
             patch('apps.chats.views.ChatMemory.objects.filter') as mock_filter:
            mock_filter.return_value.delete.return_value = (0, {})
            delete_response = self.client.delete(f'/api/v1/sessions/{self.session.id}/documents/{doc.id}/')

        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(Document.objects.filter(pk=doc.id).exists())
        mock_storage.delete_file.assert_called_once_with(doc.file_name)
        mock_filter.assert_called_once_with(session_id=self.session.id, metadata__document_id=doc.id)

        session_response = self.client.get(f'/api/v1/sessions/{self.session.id}/')
        self.assertEqual(session_response.status_code, 200)

        documents_response = self.client.get(f'/api/v1/sessions/{self.session.id}/documents/')
        self.assertEqual(documents_response.status_code, 200)
        self.assertEqual(documents_response.json(), [])


class DocumentProcessingTaskTests(TestCase):
    def setUp(self):
        self.session = Session.objects.create(kind=SESSION_KIND_CHAT, title='문서 처리 세션')

    def test_update_document_progress_keeps_processed_pages_monotonic(self):
        doc = Document.objects.create(
            session=self.session,
            file_name='1/sample.pdf',
            original_name='sample.pdf',
            file_url='http://example.com/sample.pdf',
            status=Document.STATUS_PROCESSING,
            total_pages=10,
            processed_pages=5,
            progress_label='5 / 10 페이지 텍스트 추출 중',
        )

        update_document_progress(
            doc,
            total_pages=10,
            processed_pages=3,
            progress_label='3 / 10 페이지 이미지 추출 중',
        )

        doc.refresh_from_db()
        self.assertEqual(doc.processed_pages, 5)
        self.assertEqual(doc.progress_label, '3 / 10 페이지 이미지 추출 중')

    def test_process_pdf_document_skips_page_ocr_when_disabled(self):
        doc = Document.objects.create(
            session=self.session,
            file_name='1/sample.pdf',
            original_name='sample.pdf',
            file_url='http://example.com/sample.pdf',
            status=Document.STATUS_PENDING,
        )
        storage = MagicMock()

        class DummyPdfDoc:
            page_count = 1

            def load_page(self, _index):
                return object()

            def close(self):
                return None

        parsed_chunk = {
            'text': '테스트 문서 본문',
            'bbox': [0, 0, 100, 20],
            'page': 1,
            'source_type': 'parsed',
            'page_width': 100.0,
            'page_height': 200.0,
        }

        with patch.dict(os.environ, {'DOCUMENT_PAGE_OCR_ENABLED': 'false'}, clear=False):
            with patch('apps.chats.tasks.minio_client', storage), \
                 patch('apps.chats.tasks.fitz.open', return_value=DummyPdfDoc()), \
                 patch('apps.chats.tasks.extract_text_blocks_from_page', return_value=[parsed_chunk]), \
                 patch('apps.chats.tasks.extract_images_from_page', return_value=[]), \
                 patch('apps.chats.tasks.extract_ocr_blocks_from_page') as mock_ocr, \
                 patch('apps.chats.tasks.ChatMemoryService') as mock_service_cls:
                process_pdf_document.run(doc.id)

        doc.refresh_from_db()
        self.assertEqual(doc.status, Document.STATUS_COMPLETED)
        self.assertEqual(doc.total_pages, 1)
        self.assertEqual(doc.processed_pages, 1)
        self.assertEqual(doc.progress_label, '완료')
        mock_ocr.assert_not_called()
        storage.download_file_to_path.assert_called_once()
        mock_service_cls.return_value.add_memory.assert_called_once()

    def test_process_pdf_document_skips_image_ocr_when_disabled(self):
        doc = Document.objects.create(
            session=self.session,
            file_name='1/sample.pdf',
            original_name='sample.pdf',
            file_url='http://example.com/sample.pdf',
            status=Document.STATUS_PENDING,
        )
        storage = MagicMock()

        class DummyPdfDoc:
            page_count = 1

            def load_page(self, _index):
                return object()

            def close(self):
                return None

        parsed_chunk = {
            'text': '테스트 문서 본문',
            'bbox': [0, 0, 100, 20],
            'page': 1,
            'source_type': 'parsed',
            'page_width': 100.0,
            'page_height': 200.0,
        }
        image_chunk = {
            'text': '',
            'bbox': [0, 20, 100, 100],
            'page': 1,
            'source_type': 'image_ocr',
            'image_url': 'http://example.com/image.png',
            'page_width': 100.0,
            'page_height': 200.0,
            'is_image_ocr': True,
        }

        with patch.dict(
            os.environ,
            {'DOCUMENT_PAGE_OCR_ENABLED': 'false', 'DOCUMENT_IMAGE_OCR_ENABLED': 'false'},
            clear=False,
        ):
            with patch('apps.chats.tasks.minio_client', storage), \
                 patch('apps.chats.tasks.fitz.open', return_value=DummyPdfDoc()), \
                 patch('apps.chats.tasks.extract_text_blocks_from_page', return_value=[parsed_chunk]), \
                 patch('apps.chats.tasks.extract_images_from_page', return_value=[image_chunk]), \
                 patch('apps.chats.tasks.extract_ocr_blocks_from_page') as mock_page_ocr, \
                 patch('apps.chats.tasks.ChatMemoryService') as mock_service_cls:
                process_pdf_document.run(doc.id)

        doc.refresh_from_db()
        self.assertEqual(doc.status, Document.STATUS_COMPLETED)
        mock_page_ocr.assert_not_called()
        mock_service_cls.return_value.ocr_image_with_fal.assert_not_called()
        storage.download_file_to_path.assert_called_once()
        mock_service_cls.return_value.add_memory.assert_called_once()

    def test_process_pdf_document_indexes_page_by_page(self):
        doc = Document.objects.create(
            session=self.session,
            file_name='1/sample.pdf',
            original_name='sample.pdf',
            file_url='http://example.com/sample.pdf',
            status=Document.STATUS_PENDING,
        )
        storage = MagicMock()

        class DummyPdfDoc:
            page_count = 2

            def load_page(self, index):
                return f'page-{index + 1}'

            def close(self):
                return None

        page_chunks = {
            'page-1': [{
                'text': '첫 페이지 본문',
                'bbox': [0, 0, 100, 20],
                'page': 1,
                'source_type': 'parsed',
                'page_width': 100.0,
                'page_height': 200.0,
            }],
            'page-2': [{
                'text': '둘째 페이지 본문',
                'bbox': [0, 0, 100, 20],
                'page': 2,
                'source_type': 'parsed',
                'page_width': 100.0,
                'page_height': 200.0,
            }],
        }

        def extract_for_page(page, _page_number):
            return page_chunks[page]

        with patch.dict(
            os.environ,
            {'DOCUMENT_PAGE_OCR_ENABLED': 'false', 'DOCUMENT_IMAGE_OCR_ENABLED': 'false'},
            clear=False,
        ):
            with patch('apps.chats.tasks.minio_client', storage), \
                 patch('apps.chats.tasks.fitz.open', return_value=DummyPdfDoc()), \
                 patch('apps.chats.tasks.extract_text_blocks_from_page', side_effect=extract_for_page), \
                 patch('apps.chats.tasks.extract_images_from_page', return_value=[]), \
                 patch('apps.chats.tasks.ChatMemoryService') as mock_service_cls:
                process_pdf_document.run(doc.id)

        doc.refresh_from_db()
        self.assertEqual(doc.status, Document.STATUS_COMPLETED)
        self.assertEqual(doc.total_pages, 2)
        self.assertEqual(doc.processed_pages, 2)
        self.assertEqual(mock_service_cls.return_value.add_memory.call_count, 2)
