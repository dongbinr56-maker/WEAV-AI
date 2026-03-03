"""
유튜브 watch HTML에서 duration(lengthSeconds) 추출 테스트.
Docker 환경에서만 실행: docker compose run --rm api python manage.py test
"""

from django.test import SimpleTestCase

from apps.core.views import _extract_youtube_length_seconds_from_watch_html


class YouTubeDurationExtractionTests(SimpleTestCase):
    def test_extract_length_seconds_string(self):
        html = '... "lengthSeconds":"2410" ...'
        self.assertEqual(_extract_youtube_length_seconds_from_watch_html(html), 2410)

    def test_extract_length_seconds_number(self):
        html = '... "lengthSeconds": 125 ...'
        self.assertEqual(_extract_youtube_length_seconds_from_watch_html(html), 125)

    def test_extract_approx_duration_ms_fallback(self):
        html = '... "approxDurationMs":"90500" ...'
        self.assertEqual(_extract_youtube_length_seconds_from_watch_html(html), 90)

    def test_extract_none_when_missing(self):
        html = '<html>No duration here</html>'
        self.assertIsNone(_extract_youtube_length_seconds_from_watch_html(html))

