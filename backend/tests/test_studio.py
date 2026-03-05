"""
Studio API 테스트 (LLM, Image, TTS, Video).
fal_client 호출은 mock하여 실제 API 호출 없이 검증합니다.
"""
from unittest.mock import patch
from django.test import TestCase, Client

from apps.core.views import (
    STUDIO_LLM_PROMPT_MAX,
    STUDIO_IMAGE_PROMPT_MAX,
    STUDIO_TTS_TEXT_MAX,
)


class StudioLLMTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_studio_llm_missing_prompt_400(self):
        resp = self.client.post(
            '/api/v1/studio/llm/',
            data={},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_studio_llm_prompt_too_long_400(self):
        resp = self.client.post(
            '/api/v1/studio/llm/',
            data={'prompt': 'x' * (STUDIO_LLM_PROMPT_MAX + 1)},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('prompt', resp.json().get('error', '').lower())

    @patch('apps.ai.fal_client.chat_completion')
    def test_studio_llm_ok(self, mock_chat):
        mock_chat.return_value = '안녕하세요'
        resp = self.client.post(
            '/api/v1/studio/llm/',
            data={'prompt': 'hello'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['output'], '안녕하세요')


class StudioImageTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_studio_image_missing_prompt_400(self):
        resp = self.client.post(
            '/api/v1/studio/image/',
            data={},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_studio_image_prompt_too_long_400(self):
        resp = self.client.post(
            '/api/v1/studio/image/',
            data={'prompt': 'x' * (STUDIO_IMAGE_PROMPT_MAX + 1)},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)


class StudioTTSTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_studio_tts_missing_text_400(self):
        resp = self.client.post(
            '/api/v1/studio/tts/',
            data={},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)


class StudioBgRemoveTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_studio_bg_remove_missing_image_url_400(self):
        resp = self.client.post(
            '/api/v1/studio/bg-remove/',
            data={},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    @patch('apps.ai.fal_client.remove_background_fal')
    def test_studio_bg_remove_ok(self, mock_rembg):
        mock_rembg.return_value = {'url': 'https://example.com/cutout.png'}
        resp = self.client.post(
            '/api/v1/studio/bg-remove/',
            data={'image_url': 'https://example.com/in.png', 'crop_to_bbox': False},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['image']['url'], 'https://example.com/cutout.png')

    def test_studio_tts_text_too_long_400(self):
        resp = self.client.post(
            '/api/v1/studio/tts/',
            data={'text': 'x' * (STUDIO_TTS_TEXT_MAX + 1)},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)


class StudioVideoTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_studio_video_missing_clips_400(self):
        resp = self.client.post(
            '/api/v1/studio/video/',
            data={},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_studio_video_empty_clips_400(self):
        resp = self.client.post(
            '/api/v1/studio/video/',
            data={'clips': []},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_studio_video_clip_missing_image_url_400(self):
        resp = self.client.post(
            '/api/v1/studio/video/',
            data={
                'clips': [{'image_url': '', 'audio_url': 'https://example.com/a.mp3', 'duration_sec': 5}],
            },
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
