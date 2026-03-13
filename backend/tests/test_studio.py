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

    @patch('apps.core.views._gemini_generate_text')
    def test_studio_llm_google_ai_studio_ok(self, mock_gemini):
        mock_gemini.return_value = '최신 조사 기반 주제'
        resp = self.client.post(
            '/api/v1/studio/llm/',
            data={
                'prompt': '이란 하메네이 관련 최신 주제 조사 후 추천',
                'model': 'google/gemini-2.5-flash',
                'provider': 'google-ai-studio',
                'google_search': True,
            },
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['output'], '최신 조사 기반 주제')
        mock_gemini.assert_called_once()

    @patch('apps.core.views._gemini_generate_text')
    def test_studio_llm_google_ai_studio_with_schema_ok(self, mock_gemini):
        mock_gemini.return_value = '{"master_script":"ok"}'
        resp = self.client.post(
            '/api/v1/studio/llm/',
            data={
                'prompt': '구조화된 응답 테스트',
                'provider': 'google-ai-studio',
                'google_search': True,
                'response_mime_type': 'application/json',
                'response_schema': {
                    'type': 'object',
                    'properties': {'master_script': {'type': 'string'}},
                    'required': ['master_script'],
                },
            },
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['output'], '{"master_script":"ok"}')
        mock_gemini.assert_called_once()


class StudioResearchTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_studio_research_missing_query_400(self):
        resp = self.client.post(
            '/api/v1/studio/research/',
            data={},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    @patch('apps.core.views._gemini_generate_text')
    @patch('apps.ai.retrieval.get_web_search_context')
    def test_studio_research_ok(self, mock_search, mock_gemini):
        mock_search.return_value = 'AP: 알리 하메네이는 2026년 2월 28일 사망. 후계 구도 진행 중.'
        mock_gemini.return_value = (
            '{"research_summary":"최신 보도 기준으로 하메네이 사망 이후 후계 구도가 핵심이다.",'
            '"recommended_framing":"하메네이 사망 이후, 이란 권력 재편의 진짜 승자는 누구인가?",'
            '"fact_status":"confirmed",'
            '"confirmed_facts":["알리 하메네이는 최근 보도 기준 사망이 확인됐다."],'
            '"uncertain_points":["권력 재편의 최종 승자는 아직 유동적이다."],'
            '"stale_or_risky_claims":["하메네이의 최근 근황을 다루는 식의 프레이밍"],'
            '"editorial_angles":["사망 이후 권력 재편과 국제 파장"]}'
        )

        resp = self.client.post(
            '/api/v1/studio/research/',
            data={
                'query': '하메네이 최신 사실 확인',
                'purpose': 'step2 topic generation',
                'topic': '이란 최고 지도자 하메네이 관련 주제',
                'tags': ['이란', '하메네이'],
            },
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['used_search'])
        self.assertEqual(data['fact_status'], 'confirmed')
        self.assertIn('사망', data['research_summary'])
        self.assertTrue(data['stale_or_risky_claims'])

    @patch('apps.ai.retrieval.get_web_search_context')
    def test_studio_research_without_context_returns_empty_brief(self, mock_search):
        mock_search.return_value = ''
        resp = self.client.post(
            '/api/v1/studio/research/',
            data={'query': '일반적인 콘텐츠 아이디어 최신 사실 확인'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertFalse(data['used_search'])
        self.assertEqual(data['confirmed_facts'], [])


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

    @patch('apps.ai.fal_client.image_generation_fal')
    def test_studio_image_forwards_image_urls_and_render_options(self, mock_image_generation):
        mock_image_generation.return_value = [{'url': 'https://example.com/generated.png'}]
        resp = self.client.post(
            '/api/v1/studio/image/',
            data={
                'prompt': 'reference turnaround sheet',
                'model': 'fal-ai/nano-banana-2/edit',
                'aspect_ratio': '9:16',
                'image_urls': ['https://example.com/a.png', 'https://example.com/b.png'],
                'resolution': '4K',
                'output_format': 'png',
            },
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        mock_image_generation.assert_called_once()
        _, kwargs = mock_image_generation.call_args
        self.assertEqual(kwargs['aspect_ratio'], '9:16')
        self.assertEqual(kwargs['image_urls'], ['https://example.com/a.png', 'https://example.com/b.png'])
        self.assertEqual(kwargs['resolution'], '4K')
        self.assertEqual(kwargs['output_format'], 'png')

    @patch('apps.ai.fal_client.image_generation_fal')
    def test_studio_image_forwards_reference_image_url(self, mock_image_generation):
        mock_image_generation.return_value = [{'url': 'https://example.com/generated.png'}]
        resp = self.client.post(
            '/api/v1/studio/image/',
            data={
                'prompt': 'reference turnaround sheet',
                'model': 'fal-ai/nano-banana-2/edit',
                'aspect_ratio': '9:16',
                'reference_image_url': 'https://example.com/a.png',
                'resolution': '4K',
                'output_format': 'png',
            },
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        mock_image_generation.assert_called_once()
        _, kwargs = mock_image_generation.call_args
        self.assertEqual(kwargs['reference_image_url'], 'https://example.com/a.png')
        self.assertEqual(kwargs['resolution'], '4K')
        self.assertEqual(kwargs['output_format'], 'png')


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
