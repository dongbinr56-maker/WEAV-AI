import json
import logging
import re
from urllib.parse import parse_qs, urlparse

import requests
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django_ratelimit.decorators import ratelimit
from decouple import config

logger = logging.getLogger(__name__)

# Studio API 입력 제한 (비용·리소스 보호)
STUDIO_LLM_PROMPT_MAX = 100_000
STUDIO_LLM_SYSTEM_MAX = 50_000
STUDIO_IMAGE_PROMPT_MAX = 10_000
STUDIO_VIDEO_PROMPT_MAX = 12_000
STUDIO_TTS_TEXT_MAX = 5_000
STUDIO_RESEARCH_QUERY_MAX = 12_000
STUDIO_RESEARCH_CONTEXT_MAX = 12_000

# SPA에서 쿠키 기반 세션 미사용 시 csrf_exempt 필요. 인증 추가 시 CSRF 토큰 처리로 전환 권장.


def _check_ratelimit(request):
    """django-ratelimit block=False 사용 시, 제한 초과 시 429 반환."""
    if getattr(request, 'limited', False):
        return JsonResponse({'error': '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'}, status=429)
    return None


YOUTUBE_OEMBED_URL = 'https://www.youtube.com/oembed'
YOUTUBE_WATCH_URL = 'https://www.youtube.com/watch'
YOUTUBE_WATCH_USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
)
_YOUTUBE_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{11}$')
YOUTUBE_BENCHMARK_MAX_DURATION_SECONDS = 40 * 60
YOUTUBE_TRANSCRIPT_MAX_CHARS = 40_000


def health(request):
    return JsonResponse({'status': 'ok'})


def _extract_youtube_video_id(raw: str):
    value = (raw or '').strip()
    if not value:
        return None
    if _YOUTUBE_ID_RE.match(value):
        return value

    try:
        parsed = urlparse(value)
    except Exception:
        return None

    host = (parsed.netloc or '').lower()
    path = (parsed.path or '').strip('/')
    query = parse_qs(parsed.query or '')

    if host in ('youtu.be', 'www.youtu.be') and path:
        candidate = path.split('/')[0]
        return candidate if _YOUTUBE_ID_RE.match(candidate) else None

    if host in ('youtube.com', 'www.youtube.com', 'm.youtube.com'):
        if path == 'watch':
            candidate = (query.get('v') or [''])[0]
            return candidate if _YOUTUBE_ID_RE.match(candidate) else None
        if path.startswith('shorts/'):
            candidate = path.split('/', 1)[1].split('/')[0]
            return candidate if _YOUTUBE_ID_RE.match(candidate) else None
        if path.startswith('embed/'):
            candidate = path.split('/', 1)[1].split('/')[0]
            return candidate if _YOUTUBE_ID_RE.match(candidate) else None

    return None


def _fetch_youtube_oembed(video_url: str):
    try:
        r = requests.get(
            YOUTUBE_OEMBED_URL,
            params={'url': video_url, 'format': 'json'},
            timeout=10,
            headers={'User-Agent': YOUTUBE_WATCH_USER_AGENT},
        )
        r.raise_for_status()
        data = r.json()
        return {
            'title': (data.get('title') or '').strip(),
            'channel': (data.get('author_name') or '').strip(),
            'thumbnail': (data.get('thumbnail_url') or '').strip(),
        }
    except Exception as e:
        logger.info('youtube oembed fetch failed: %s', e)
        return {'title': '', 'channel': '', 'thumbnail': ''}


def _extract_short_description_from_watch_html(html: str):
    if not html:
        return ''
    # watch HTML contains JSON-escaped shortDescription; decode safely via json.loads on quoted string.
    m = re.search(r'"shortDescription"\s*:\s*"((?:[^"\\]|\\.)*)"', html)
    if not m:
        return ''
    try:
        return json.loads(f'"{m.group(1)}"').strip()
    except Exception:
        return ''


def _extract_youtube_length_seconds_from_watch_html(html: str) -> int | None:
    """
    Best-effort duration extraction from YouTube watch HTML.
    - Prefer `lengthSeconds` if present.
    - Fallback to `approxDurationMs` (ms) if present.
    """
    if not html:
        return None

    # Most common: "lengthSeconds":"2410"
    m = re.search(r'"lengthSeconds"\s*:\s*"(\d+)"', html)
    if not m:
        # Sometimes appears as a number (rare): "lengthSeconds": 2410
        m = re.search(r'"lengthSeconds"\s*:\s*(\d+)', html)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return None

    # Fallback: "approxDurationMs":"2410000"
    m = re.search(r'"approxDurationMs"\s*:\s*"(\d+)"', html)
    if m:
        try:
            return int(int(m.group(1)) / 1000)
        except Exception:
            return None

    return None


def _fetch_youtube_watch_html(video_id: str) -> str:
    try:
        r = requests.get(
            YOUTUBE_WATCH_URL,
            params={'v': video_id},
            timeout=15,
            headers={'User-Agent': YOUTUBE_WATCH_USER_AGENT, 'Accept-Language': 'ko,en;q=0.9'},
        )
        r.raise_for_status()
        return r.text or ''
    except Exception as e:
        logger.info('youtube watch fetch failed: %s', e)
        return ''


def _fetch_youtube_watch_details(video_id: str) -> dict:
    html = _fetch_youtube_watch_html(video_id)
    return {
        'description': _extract_short_description_from_watch_html(html),
        'durationSeconds': _extract_youtube_length_seconds_from_watch_html(html),
    }


def _fetch_youtube_transcript(video_id: str):
    def _format_ts(seconds: float | int | None) -> str:
        try:
            sec = int(float(seconds or 0))
        except Exception:
            sec = 0
        h = sec // 3600
        m = (sec % 3600) // 60
        s = sec % 60
        if h > 0:
            return f'{h:02d}:{m:02d}:{s:02d}'
        return f'{m:02d}:{s:02d}'

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except Exception:
        return ''
    try:
        items = YouTubeTranscriptApi.get_transcript(video_id, languages=['ko', 'en'])
    except Exception as e:
        logger.info('youtube transcript fetch failed: %s', e)
        return ''

    chunks = []
    total_len = 0
    for item in items or []:
        text = str(item.get('text') or '').replace('\n', ' ').strip()
        if not text:
            continue
        # Include timestamps so the model can reference the full timeline accurately.
        ts = _format_ts(item.get('start'))
        line = f'[{ts}] {text}'
        chunks.append(line)
        total_len += len(line) + 1
        if total_len >= YOUTUBE_TRANSCRIPT_MAX_CHARS:
            break
    return ' '.join(chunks).strip()


def _build_youtube_context_payload(raw_url: str):
    video_id = _extract_youtube_video_id(raw_url)
    if not video_id:
        return None

    canonical_url = f'https://www.youtube.com/watch?v={video_id}'
    oembed = _fetch_youtube_oembed(canonical_url)
    transcript = _fetch_youtube_transcript(video_id)
    watch = _fetch_youtube_watch_details(video_id)
    description = watch.get('description') or ''
    duration_seconds = watch.get('durationSeconds')
    return {
        'videoId': video_id,
        'url': canonical_url,
        'title': oembed.get('title') or '',
        'channel': oembed.get('channel') or '',
        'thumbnail': oembed.get('thumbnail') or '',
        'description': description[:4000] if description else '',
        'transcript': transcript,
        'hasTranscript': bool(transcript),
        'durationSeconds': duration_seconds,
        'source': {
            'oembed': bool(oembed.get('title') or oembed.get('channel')),
            'description': bool(description),
            'transcript': bool(transcript),
            'duration': isinstance(duration_seconds, int) and duration_seconds > 0,
        },
    }


@require_GET
def studio_youtube_context(request):
    """
    유튜브 분석용 실제 소스 데이터 수집.
    GET ?url=... -> { videoId, title, channel, description, transcript, hasTranscript, durationSeconds, source }
    """
    raw_url = (request.GET.get('url') or '').strip()
    if not raw_url:
        return JsonResponse({'error': 'url query param required'}, status=400)

    payload = _build_youtube_context_payload(raw_url)
    if not payload:
        return JsonResponse({'error': 'invalid YouTube URL'}, status=400)
    return JsonResponse(payload)


def _gemini_extract_text(response_data: dict) -> str:
    for cand in (response_data.get('candidates') or []):
        content = (cand or {}).get('content') or {}
        parts = content.get('parts') or []
        texts = []
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get('text'), str):
                texts.append(part['text'])
        if texts:
            return ''.join(texts).strip()
    return ''


def _safe_json_loads(value: str | bytes | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _string_list(value, limit: int = 12) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if text:
            items.append(text)
        if len(items) >= limit:
            break
    return items


def _gemini_api_key() -> str:
    return config('GEMINI_API_KEY', default='').strip() or config('GOOGLE_API_KEY', default='').strip()


def _normalize_google_ai_studio_model(model: str | None) -> str:
    model_name = (model or 'google/gemini-2.5-flash').strip() or 'google/gemini-2.5-flash'
    if model_name.startswith('google/'):
        model_name = model_name.split('/', 1)[1]
    return model_name or 'gemini-2.5-flash'


def _gemini_generate_text(
    prompt: str,
    system_prompt: str | None = None,
    model: str | None = None,
    google_search: bool = False,
    response_mime_type: str | None = None,
    response_schema: dict | None = None,
) -> str:
    """
    Google AI Studio Gemini direct call.
    If `google_search` is True, enable Google Search grounding for fresh/public facts.
    """
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError('GEMINI_API_KEY (or GOOGLE_API_KEY) not configured')

    model_name = _normalize_google_ai_studio_model(model)
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent'
    generation_config: dict[str, object] = {
        'temperature': 0.2,
    }
    if response_mime_type:
        generation_config['responseMimeType'] = response_mime_type
    if response_schema:
        generation_config['responseJsonSchema'] = response_schema

    payload: dict[str, object] = {
        'contents': [{
            'role': 'user',
            'parts': [{'text': prompt}],
        }],
        'generationConfig': generation_config,
    }
    if system_prompt:
        payload['systemInstruction'] = {
            'parts': [{'text': system_prompt}],
        }
    if google_search:
        payload['tools'] = [{'google_search': {}}]

    r = requests.post(
        url,
        headers={
            'Content-Type': 'application/json',
            'x-goog-api-key': api_key,
        },
        json=payload,
        timeout=120,
    )
    if not r.ok:
        try:
            err = r.json().get('error') or {}
            msg = err.get('message') or str(err)
        except Exception:
            msg = r.text or r.reason or f'HTTP {r.status_code}'
        raise RuntimeError(f'Google AI Studio Gemini 요청 실패 ({r.status_code}): {msg}')

    text = _gemini_extract_text(r.json())
    if not text:
        raise RuntimeError('Google AI Studio Gemini 응답에서 텍스트를 찾지 못했습니다.')
    return text.strip()


STUDIO_RESEARCH_SCHEMA = {
    'type': 'object',
    'additionalProperties': False,
    'properties': {
        'research_summary': {'type': 'string'},
        'recommended_framing': {'type': 'string'},
        'fact_status': {'type': 'string'},
        'confirmed_facts': {'type': 'array', 'items': {'type': 'string'}},
        'uncertain_points': {'type': 'array', 'items': {'type': 'string'}},
        'stale_or_risky_claims': {'type': 'array', 'items': {'type': 'string'}},
        'editorial_angles': {'type': 'array', 'items': {'type': 'string'}},
    },
    'required': [
        'research_summary',
        'recommended_framing',
        'fact_status',
        'confirmed_facts',
        'uncertain_points',
        'stale_or_risky_claims',
        'editorial_angles',
    ],
}


@csrf_exempt
@ratelimit(key='ip', rate='15/m', method='POST', block=False)
@require_http_methods(['POST'])
def studio_research(request):
    """
    Studio research brief. POST JSON:
    {
      query, purpose?, topic?, tags?, description?, benchmark_summary?, benchmark_patterns?
    }
    -> {
      used_search, search_query, external_context, research_summary, recommended_framing,
      fact_status, confirmed_facts[], uncertain_points[], stale_or_risky_claims[], editorial_angles[]
    }
    """
    if (r := _check_ratelimit(request)):
        return r
    body = _parse_json_body(request)
    if not body or not isinstance(body.get('query'), str):
        return JsonResponse({'error': 'query (string) required'}, status=400)

    query = (body.get('query') or '').strip()
    if not query:
        return JsonResponse({'error': 'query required'}, status=400)
    if len(query) > STUDIO_RESEARCH_QUERY_MAX:
        return JsonResponse({'error': f'query는 {STUDIO_RESEARCH_QUERY_MAX}자 이내로 입력해 주세요.'}, status=400)

    purpose = (body.get('purpose') or '').strip() if isinstance(body.get('purpose'), str) else ''
    topic = (body.get('topic') or '').strip() if isinstance(body.get('topic'), str) else ''
    description = (body.get('description') or '').strip() if isinstance(body.get('description'), str) else ''
    benchmark_summary = (body.get('benchmark_summary') or '').strip() if isinstance(body.get('benchmark_summary'), str) else ''
    tags = _string_list(body.get('tags'), limit=12)
    benchmark_patterns = _string_list(body.get('benchmark_patterns'), limit=12)

    try:
        from apps.ai.retrieval import get_web_search_context
    except ImportError as e:
        logger.exception('studio_research import')
        return JsonResponse({'error': str(e)}, status=503)

    external_context = get_web_search_context(query, num=8) or ''
    external_context = external_context.strip()
    if len(external_context) > STUDIO_RESEARCH_CONTEXT_MAX:
        external_context = external_context[:STUDIO_RESEARCH_CONTEXT_MAX].rstrip() + '\n…(truncated)'

    if not external_context:
        return JsonResponse({
            'used_search': False,
            'search_query': query,
            'external_context': '',
            'research_summary': '',
            'recommended_framing': topic or query,
            'fact_status': 'latest_search_unavailable',
            'confirmed_facts': [],
            'uncertain_points': [],
            'stale_or_risky_claims': [],
            'editorial_angles': [],
        })

    summarize_prompt = '\n'.join([
        f'Purpose: {purpose or "studio planning"}',
        f'Original topic or subject: {topic or "(none)"}',
        f'Tags: {", ".join(tags) if tags else "(none)"}',
        f'Description: {description or "(none)"}',
        f'Benchmark summary: {benchmark_summary or "(none)"}',
        f'Benchmark patterns: {" | ".join(benchmark_patterns) if benchmark_patterns else "(none)"}',
        '',
        'Use the following latest external context as the source of truth:',
        external_context,
        '',
        'Return the JSON fact sheet only.',
    ])
    summarize_system = '\n'.join([
        'You are the research editor for WEAV Studio.',
        'Your job is to convert raw latest-search context into a clean fact sheet for topic recommendation, planning, and script writing.',
        'Use ONLY the provided external context for time-sensitive claims. Do not invent facts beyond it.',
        'Write all string outputs in Korean.',
        'research_summary: 3~6 concise sentences summarizing the latest situation.',
        'recommended_framing: a safer, up-to-date editorial framing or working topic the downstream planner should use.',
        'fact_status: one short label like confirmed / mixed / evolving / latest_search_unavailable.',
        'confirmed_facts: concrete facts clearly supported by the context.',
        'uncertain_points: unresolved or conflicting points that should be handled carefully.',
        'stale_or_risky_claims: outdated, misleading, or dangerous framings implied by the user input that the planner should avoid.',
        'editorial_angles: safe but compelling angles that can still drive clicks without distorting the facts.',
        'Return valid JSON only.',
    ])

    parsed = {}
    try:
        raw = _gemini_generate_text(
            summarize_prompt,
            system_prompt=summarize_system,
            model='google/gemini-2.5-flash',
            response_mime_type='application/json',
            response_schema=STUDIO_RESEARCH_SCHEMA,
        )
        parsed = _safe_json_loads(raw)
    except Exception:
        logger.exception('studio_research summarize')

    return JsonResponse({
        'used_search': True,
        'search_query': query,
        'external_context': external_context,
        'research_summary': (parsed.get('research_summary') or '').strip() if isinstance(parsed.get('research_summary'), str) else '',
        'recommended_framing': (parsed.get('recommended_framing') or topic or query).strip() if isinstance(parsed.get('recommended_framing'), str) else (topic or query),
        'fact_status': (parsed.get('fact_status') or 'confirmed').strip() if isinstance(parsed.get('fact_status'), str) else 'confirmed',
        'confirmed_facts': _string_list(parsed.get('confirmed_facts'), limit=8),
        'uncertain_points': _string_list(parsed.get('uncertain_points'), limit=6),
        'stale_or_risky_claims': _string_list(parsed.get('stale_or_risky_claims'), limit=6),
        'editorial_angles': _string_list(parsed.get('editorial_angles'), limit=8),
    })


def _gemini_generate_dual_benchmark_json(prompt: str, system_prompt: str, model: str | None = None) -> dict:
    """
    Dual benchmark JSON via fal OpenRouter LLM (openrouter/router).
    """
    try:
        from apps.ai.fal_client import chat_completion
        from apps.ai.errors import FALError
    except Exception as e:
        raise RuntimeError(f'LLM 모듈을 불러오지 못했습니다: {e}')

    model_name = (model or 'google/gemini-2.5-flash').strip() or 'google/gemini-2.5-flash'
    # Backward-compat: accept bare Gemini ids used by older clients.
    if '/' not in model_name and model_name.startswith('gemini-'):
        model_name = f'google/{model_name}'

    try:
        text = chat_completion(prompt, model=model_name, system_prompt=system_prompt, temperature=0.2, max_tokens=4096)
    except FALError as e:
        raise RuntimeError(str(e))
    except Exception as e:
        raise RuntimeError(f'LLM 요청 실패: {e}')

    try:
        cleaned = text.strip()
        cleaned = re.sub(r'^```json\s*', '', cleaned)
        cleaned = re.sub(r'^```\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
        start = cleaned.find('{')
        end = cleaned.rfind('}')
        if start != -1 and end != -1 and end > start:
            cleaned = cleaned[start:end + 1]
        return json.loads(cleaned)
    except Exception:
        raise RuntimeError('LLM 응답 JSON 파싱에 실패했습니다.')


def _gemini_generate_youtube_url_dual_benchmark_json(
    youtube_url: str,
    prompt: str,
    system_prompt: str,
    model: str | None = None,
) -> dict:
    """
    Gemini Video Understanding (YouTube URL direct input) with dual benchmark JSON output.
    (YouTube URL을 Gemini에 직접 넣는 기능은 OpenRouter가 아닌 Google Gemini API 경로입니다.)
    """
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError('GEMINI_API_KEY (or GOOGLE_API_KEY) not configured')

    default_model = config('GEMINI_BENCHMARK_VIDEO_MODEL', default='gemini-3-flash-preview') or 'gemini-3-flash-preview'
    model_name = (model or default_model).strip()
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent'
    payload = {
        'systemInstruction': {
            'parts': [{'text': system_prompt}],
        },
        'contents': [{
            'role': 'user',
            'parts': [
                {
                    'fileData': {
                        'fileUri': youtube_url,
                    }
                },
                {'text': prompt},
            ],
        }],
        'generationConfig': {
            'temperature': 0.2,
            'responseMimeType': 'application/json',
            'responseJsonSchema': {
                'type': 'object',
                'properties': {
                    'content': {
                        'type': 'object',
                        'properties': {
                            'summary': {'type': 'string'},
                            'keyPoints': {
                                'type': 'array',
                                'items': {'type': 'string'},
                            },
                        },
                        'required': ['summary', 'keyPoints'],
                    },
                    'delivery': {
                        'type': 'object',
                        'properties': {
                            'summary': {'type': 'string'},
                            'patterns': {
                                'type': 'array',
                                'items': {'type': 'string'},
                            },
                        },
                        'required': ['summary', 'patterns'],
                    },
                },
                'required': ['content', 'delivery'],
            },
        },
    }
    r = requests.post(
        url,
        headers={
            'Content-Type': 'application/json',
            'x-goog-api-key': api_key,
        },
        json=payload,
        timeout=120,
    )
    if not r.ok:
        try:
            err = r.json().get('error') or {}
            msg = err.get('message') or str(err)
        except Exception:
            msg = r.text or r.reason or f'HTTP {r.status_code}'
        raise RuntimeError(f'Gemini YouTube URL 분석 요청 실패 ({r.status_code}): {msg}')
    data = r.json()
    text = _gemini_extract_text(data)
    if not text:
        raise RuntimeError('Gemini YouTube URL 응답에서 텍스트를 찾지 못했습니다.')
    try:
        return json.loads(text)
    except Exception:
        cleaned = text.strip()
        cleaned = re.sub(r'^```json\s*', '', cleaned)
        cleaned = re.sub(r'^```\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
        return json.loads(cleaned)


def _gemini_generate_youtube_url_json(youtube_url: str, prompt: str, system_prompt: str, model: str | None = None) -> dict:
    """
    Gemini Video Understanding (YouTube URL direct input, preview feature).
    Docs: video understanding -> Pass YouTube URLs
    """
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError('GEMINI_API_KEY (or GOOGLE_API_KEY) not configured')

    default_model = config('GEMINI_BENCHMARK_VIDEO_MODEL', default='gemini-3-flash-preview') or 'gemini-3-flash-preview'
    model_name = (model or default_model).strip()
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent'
    payload = {
        'systemInstruction': {
            'parts': [{'text': system_prompt}],
        },
        'contents': [{
            'role': 'user',
            'parts': [
                {
                    'fileData': {
                        # Official docs (Video understanding > Pass YouTube URLs) support public YouTube URL here.
                        'fileUri': youtube_url,
                    }
                },
                {'text': prompt},
            ],
        }],
        'generationConfig': {
            'temperature': 0.2,
            'responseMimeType': 'application/json',
            'responseJsonSchema': {
                'type': 'object',
                'properties': {
                    'summary': {'type': 'string'},
                    'patterns': {
                        'type': 'array',
                        'items': {'type': 'string'},
                    },
                },
                'required': ['summary', 'patterns'],
            },
        },
    }
    r = requests.post(
        url,
        headers={
            'Content-Type': 'application/json',
            'x-goog-api-key': api_key,
        },
        json=payload,
        timeout=120,
    )
    if not r.ok:
        try:
            err = r.json().get('error') or {}
            msg = err.get('message') or str(err)
        except Exception:
            msg = r.text or r.reason or f'HTTP {r.status_code}'
        raise RuntimeError(f'Gemini YouTube URL 분석 요청 실패 ({r.status_code}): {msg}')
    data = r.json()
    text = _gemini_extract_text(data)
    if not text:
        raise RuntimeError('Gemini YouTube URL 응답에서 텍스트를 찾지 못했습니다.')
    try:
        return json.loads(text)
    except Exception:
        cleaned = text.strip()
        cleaned = re.sub(r'^```json\s*', '', cleaned)
        cleaned = re.sub(r'^```\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
        return json.loads(cleaned)


def _build_youtube_benchmark_prompt(ctx: dict) -> tuple[str, str]:
    system_prompt = (
        'Persona: You are a senior YouTube content analyst and benchmarking specialist. '
        'You have deep, practical knowledge of high-retention structures and can extract reusable patterns for creators. '
        'You follow the user request precisely and produce excellent, evidence-based outputs. '
        'You do not mention this persona in the output. '
        'You analyze YouTube video structure in Korean. '
        'Use ONLY the provided source data (title, channel, description, transcript). '
        'Do not invent plot details that are not present in the provided data. '
        'If transcript is missing, explicitly state that the result is metadata-based analysis.'
    )
    prompt = '\n'.join([
        '다음 유튜브 영상의 실제 수집 데이터(제목/채널/설명/자막)를 바탕으로 영상 구조와 패턴을 분석해주세요.',
        '중요: 제공된 데이터에 없는 내용을 추측하지 마세요.',
        '자막이 없으면 "메타데이터 기반 분석"임을 summary에 명시하고, 패턴도 일반적인 편집/구성 레벨로만 작성하세요.',
        '자막이 길면 일부만 제공될 수 있습니다. 제공된 자막 범위를 넘어서는 타임라인/내용은 단정하지 마세요.',
        '응답은 JSON만 허용됩니다: { "summary": string, "patterns": string[] }',
        '',
        f'원본 URL: {ctx.get("url") or "(없음)"}',
        f'제목: {ctx.get("title") or "(없음)"}',
        f'채널: {ctx.get("channel") or "(없음)"}',
        f'설명: {(ctx.get("description") or "(없음)")[:3000]}',
        f'자막 사용 가능 여부: {"있음" if ctx.get("hasTranscript") else "없음"}',
        f'자막(일부): {(ctx.get("transcript") or "(없음)")[:YOUTUBE_TRANSCRIPT_MAX_CHARS]}',
    ])
    return system_prompt, prompt


def _build_youtube_video_benchmark_prompt(ctx: dict) -> tuple[str, str]:
    system_prompt = (
        'Persona: You are a senior video analyst and YouTube benchmarking specialist. '
        'You have deep, hands-on expertise in analyzing pacing, hooks, editing rhythms, and retention mechanics. '
        'You follow the user request precisely and produce excellent, evidence-based outputs. '
        'You do not mention this persona in the output. '
        '당신은 영상 분석 전문가다. 유튜브 영상의 시각/음성/대사를 함께 고려해 구조를 분석한다. '
        '응답은 반드시 한국어 JSON만 출력한다. 추측성 단정은 피하고, 보이는/들리는 근거 중심으로 작성한다.'
    )
    prompt = '\n'.join([
        '이 유튜브 영상을 실제 영상 기준으로 분석해 주세요.',
        '다음 JSON 형식으로만 응답하세요: { "summary": string, "patterns": string[] }',
        'summary: 영상의 핵심 내용과 전개 방식 요약 (1~3문장, 한국어)',
        'patterns: 훅/전개/편집/자막/내레이션/결말처리/CTA 관점에서 벤치마킹 포인트 4~10개',
        '타임스탬프를 알고 있으면 패턴 문장에 포함해도 됩니다.',
        '',
        f'참고 메타데이터(정합성 체크용): 제목={ctx.get("title") or "(없음)"} / 채널={ctx.get("channel") or "(없음)"}',
        '중요: 영상 자체를 우선 근거로 삼고, 메타데이터는 보조 참고로만 사용하세요.',
    ])
    return system_prompt, prompt


def _build_youtube_benchmark_dual_prompt(ctx: dict) -> tuple[str, str]:
    """
    Metadata/transcript grounded dual benchmark prompt.
    Returns { content{summary,keyPoints}, delivery{summary,patterns} }.
    """
    system_prompt = (
        'Persona: You are a senior YouTube content analyst and benchmarking specialist. '
        'You have deep, practical knowledge of high-retention structures and can extract reusable patterns for creators. '
        'You follow the user request precisely and produce excellent, evidence-based outputs. '
        'You do not mention this persona in the output. '
        'You analyze YouTube videos in Korean. '
        'Use ONLY the provided source data (title, channel, description, transcript). '
        'Do not invent details that are not present in the provided data. '
        'If transcript is missing, explicitly state that the result is metadata-based analysis.'
    )
    prompt = '\n'.join([
        '다음 유튜브 영상의 실제 수집 데이터(제목/채널/설명/자막)를 바탕으로 2가지 결과를 JSON으로 출력해주세요.',
        '',
        '1) content: 영상 "내용 자체"를 상세하고 구체적으로 벤치마킹',
        '- content.summary: 4~10문장 한국어 요약 (자막/설명 근거 중심, 추측 금지)',
        '- content.keyPoints: 핵심 내용 포인트 6~14개 (각 1문장, 가능한 한 구체적으로)',
        '',
        '2) delivery: 시청자에게 보여주는 "진행 방식/패턴" 분석',
        '- delivery.summary: 전개 방식 요약 2~5문장 (훅/전개/편집/자막/내레이션/CTA 관점)',
        '- delivery.patterns: 벤치마킹 포인트 6~12개 (훅/전개/편집/자막/내레이션/결말/CTA)',
        '',
        '중요: 제공된 데이터에 없는 내용은 추측하지 마세요. 자막이 없으면 content.summary에 "메타데이터 기반 분석"임을 명시하세요.',
        '자막이 길면 일부만 제공될 수 있습니다. 제공된 자막 범위를 넘어서는 타임라인/내용은 단정하지 마세요.',
        '응답은 JSON만 허용됩니다: { "content": { "summary": string, "keyPoints": string[] }, "delivery": { "summary": string, "patterns": string[] } }',
        '',
        f'원본 URL: {ctx.get("url") or "(없음)"}',
        f'제목: {ctx.get("title") or "(없음)"}',
        f'채널: {ctx.get("channel") or "(없음)"}',
        f'설명: {(ctx.get("description") or "(없음)")[:3000]}',
        f'자막 사용 가능 여부: {"있음" if ctx.get("hasTranscript") else "없음"}',
        f'자막(일부): {(ctx.get("transcript") or "(없음)")[:YOUTUBE_TRANSCRIPT_MAX_CHARS]}',
    ])
    return system_prompt, prompt


def _build_youtube_video_benchmark_dual_prompt(ctx: dict) -> tuple[str, str]:
    """
    Direct YouTube URL video understanding dual benchmark prompt.
    Returns { content{summary,keyPoints}, delivery{summary,patterns} }.
    """
    system_prompt = (
        'Persona: You are a senior video analyst and YouTube benchmarking specialist. '
        'You have deep, hands-on expertise in analyzing pacing, hooks, editing rhythms, and retention mechanics. '
        'You follow the user request precisely and produce excellent, evidence-based outputs. '
        'You do not mention this persona in the output. '
        '응답은 반드시 한국어 JSON만 출력한다. 추측성 단정은 피하고, 보이는/들리는 근거 중심으로 작성한다.'
    )
    prompt = '\n'.join([
        '이 유튜브 영상을 실제 영상 기준으로 분석해, 2가지 결과를 JSON으로 출력해 주세요.',
        '',
        '1) content: 영상 "내용 자체"를 상세하고 구체적으로 벤치마킹',
        '- content.summary: 4~10문장 한국어 요약 (근거 중심, 추측 금지)',
        '- content.keyPoints: 핵심 내용 포인트 6~14개 (각 1문장)',
        '',
        '2) delivery: 시청자에게 보여주는 "진행 방식/패턴" 분석',
        '- delivery.summary: 전개 방식 요약 2~5문장 (훅/전개/편집/자막/내레이션/CTA 관점)',
        '- delivery.patterns: 벤치마킹 포인트 6~12개 (훅/전개/편집/자막/내레이션/결말/CTA)',
        '',
        '타임스탬프를 알고 있으면 delivery.patterns 문장에 포함해도 됩니다.',
        '다음 JSON 형식으로만 응답하세요: { "content": { "summary": string, "keyPoints": string[] }, "delivery": { "summary": string, "patterns": string[] } }',
        '',
        f'참고 메타데이터(정합성 체크용): 제목={ctx.get("title") or "(없음)"} / 채널={ctx.get("channel") or "(없음)"}',
        '중요: 영상 자체를 우선 근거로 삼고, 메타데이터는 보조 참고로만 사용하세요.',
    ])
    return system_prompt, prompt


@csrf_exempt
@require_http_methods(['POST'])
def studio_youtube_benchmark_analyze(request):
    """
    유튜브 URL 벤치마킹 분석.
    - 1) (옵션) Gemini Video Understanding: YouTube URL을 직접 넣어 "영상 자체" 분석
    - 2) 실패/비활성화 시: 메타데이터/자막 기반 분석(LLM)
    POST JSON: { url, model? } -> { summary, patterns, meta }
    """
    body = _parse_json_body(request)
    if not body or not isinstance(body.get('url'), str):
        return JsonResponse({'error': 'url (string) required'}, status=400)
    raw_url = (body.get('url') or '').strip()
    if not raw_url:
        return JsonResponse({'error': 'url required'}, status=400)

    ctx = _build_youtube_context_payload(raw_url)
    if not ctx:
        return JsonResponse({'error': 'invalid YouTube URL'}, status=400)
    duration_seconds = ctx.get('durationSeconds')
    if isinstance(duration_seconds, int) and duration_seconds > YOUTUBE_BENCHMARK_MAX_DURATION_SECONDS:
        mins = int(duration_seconds / 60)
        return JsonResponse({
            'error': (
                f'현재 {YOUTUBE_BENCHMARK_MAX_DURATION_SECONDS // 60}분 이상 영상 벤치마킹은 미구현 상태입니다. '
                f'({mins}분 영상 감지) {YOUTUBE_BENCHMARK_MAX_DURATION_SECONDS // 60}분 미만의 동영상 URL을 입력해주세요.'
            ),
            'meta': {
                'provider': 'google-ai-studio',
                'analysisMode': 'duration-gated',
                'durationSeconds': duration_seconds,
                'maxDurationSeconds': YOUTUBE_BENCHMARK_MAX_DURATION_SECONDS,
                'videoId': ctx.get('videoId') or '',
                'title': ctx.get('title') or '',
                'channel': ctx.get('channel') or '',
                'source': ctx.get('source') or {},
            },
        }, status=400)
    if not (ctx.get('title') or ctx.get('description') or ctx.get('transcript')):
        return JsonResponse({'error': '유튜브 영상의 제목/설명/자막을 가져오지 못했습니다.'}, status=502)

    requested_model = body.get('model')
    direct_video_enabled = str(config('GEMINI_BENCHMARK_USE_YOUTUBE_URL', default='true')).strip().lower() not in (
        '0',
        'false',
        'no',
        'off',
    )
    allow_metadata_fallback = str(config('GEMINI_BENCHMARK_ALLOW_METADATA_FALLBACK', default='false')).strip().lower() in (
        '1',
        'true',
        'yes',
        'on',
    )
    direct_video_error = ''
    has_gemini_key = bool(
        (config('GEMINI_API_KEY', default='').strip() or config('GOOGLE_API_KEY', default='').strip())
    )
    if direct_video_enabled and not has_gemini_key:
        # 키가 없으면 direct video 시도 자체를 건너뛰고 메타데이터/자막 기반 분석으로 진행.
        direct_video_enabled = False

    # 1) Try official Gemini YouTube URL video analysis first (video understanding preview feature).
    if direct_video_enabled:
        try:
            video_sys, video_prompt = _build_youtube_video_benchmark_dual_prompt(ctx)
            parsed = _gemini_generate_youtube_url_dual_benchmark_json(
                ctx.get('url') or raw_url,
                video_prompt,
                video_sys,
                model=requested_model,
            )
            content = parsed.get('content') if isinstance(parsed, dict) else None
            delivery = parsed.get('delivery') if isinstance(parsed, dict) else None

            content_summary = (content or {}).get('summary') if isinstance(content, dict) else ''
            if not isinstance(content_summary, str) or not content_summary.strip():
                content_summary = f'{ctx.get("title") or "유튜브 영상"}의 내용 요약'
            content_summary = content_summary.strip()
            content_key_points = (content or {}).get('keyPoints') if isinstance(content, dict) else []
            if not isinstance(content_key_points, list):
                content_key_points = []
            content_key_points = [str(p).strip() for p in content_key_points if str(p).strip()]
            if not content_key_points:
                content_key_points = ['핵심 메시지 1(확인 필요)', '핵심 메시지 2(확인 필요)', '핵심 메시지 3(확인 필요)']

            delivery_summary = (delivery or {}).get('summary') if isinstance(delivery, dict) else ''
            if not isinstance(delivery_summary, str) or not delivery_summary.strip():
                delivery_summary = f'{ctx.get("title") or "유튜브 영상"}의 전개/패턴 분석'
            delivery_summary = delivery_summary.strip()
            patterns = (delivery or {}).get('patterns') if isinstance(delivery, dict) else []
            if not isinstance(patterns, list):
                patterns = []
            patterns = [str(p).strip() for p in patterns if str(p).strip()]
            if not patterns:
                patterns = ['오프닝 훅 구성', '핵심 전개 리듬', '편집/자막/내레이션 패턴', '마무리 구조']

            return JsonResponse({
                'summary': delivery_summary,
                'patterns': patterns[:12],
                'content': {
                    'summary': content_summary,
                    'keyPoints': content_key_points[:14],
                },
                'delivery': {
                    'summary': delivery_summary,
                    'patterns': patterns[:12],
                },
                'meta': {
                    'provider': 'google-ai-studio',
                    'analysisMode': 'youtube-url-video',
                    'contentAnalysisMode': 'youtube-url-video',
                    'deliveryAnalysisMode': 'youtube-url-video',
                    'directVideoAttempted': True,
                    'model': (
                        requested_model
                        or config('GEMINI_BENCHMARK_VIDEO_MODEL', default='gemini-3-flash-preview')
                        or 'gemini-3-flash-preview'
                    ),
                    'hasTranscript': bool(ctx.get('hasTranscript')),
                    'durationSeconds': ctx.get('durationSeconds'),
                    'videoId': ctx.get('videoId') or '',
                    'title': ctx.get('title') or '',
                    'channel': ctx.get('channel') or '',
                    'source': ctx.get('source') or {},
                },
            })
        except Exception as e:
            direct_video_error = str(e)
            logger.warning('Gemini direct YouTube URL analysis failed, falling back to metadata/transcript: %s', e)
            if not allow_metadata_fallback:
                return JsonResponse({
                    'error': f'Gemini YouTube URL 직접 영상 분석 실패: {direct_video_error}',
                    'meta': {
                        'provider': 'google-ai-studio',
                        'analysisMode': 'youtube-url-video',
                        'directVideoAttempted': True,
                        'directVideoError': direct_video_error,
                        'durationSeconds': ctx.get('durationSeconds'),
                    },
                }, status=502)

    # 2) Fallback: metadata/transcript-grounded analysis (LLM)
    system_prompt, prompt = _build_youtube_benchmark_dual_prompt(ctx)
    try:
        parsed = _gemini_generate_dual_benchmark_json(prompt, system_prompt, model=requested_model)
    except RuntimeError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('studio_youtube_benchmark_analyze')
        return JsonResponse({'error': str(e)}, status=500)

    content = parsed.get('content') if isinstance(parsed, dict) else None
    delivery = parsed.get('delivery') if isinstance(parsed, dict) else None

    content_summary = (content or {}).get('summary') if isinstance(content, dict) else ''
    if not isinstance(content_summary, str) or not content_summary.strip():
        content_summary = f'{ctx.get("title") or "유튜브 영상"}{" 내용 요약" if ctx.get("hasTranscript") else " 메타데이터 기반 내용 추정"}'
    else:
        content_summary = content_summary.strip()
    content_key_points = (content or {}).get('keyPoints') if isinstance(content, dict) else []
    if not isinstance(content_key_points, list):
        content_key_points = []
    content_key_points = [str(p).strip() for p in content_key_points if str(p).strip()]
    if not content_key_points:
        content_key_points = (
            ['핵심 내용 포인트 1(확인 필요)', '핵심 내용 포인트 2(확인 필요)', '핵심 내용 포인트 3(확인 필요)']
            if ctx.get('hasTranscript')
            else ['제목·설명 기반 핵심 포인트', '자막 확보 후 재요약 권장', '세부 내용 추정 정확도 낮음']
        )

    delivery_summary = (delivery or {}).get('summary') if isinstance(delivery, dict) else ''
    if not isinstance(delivery_summary, str) or not delivery_summary.strip():
        delivery_summary = f'{ctx.get("title") or "유튜브 영상"}{"의 구조 분석" if ctx.get("hasTranscript") else " 메타데이터 기반 구조 추정"}'
    else:
        delivery_summary = delivery_summary.strip()
    patterns = (delivery or {}).get('patterns') if isinstance(delivery, dict) else []
    if not isinstance(patterns, list):
        patterns = []
    patterns = [str(p).strip() for p in patterns if str(p).strip()]
    if not patterns:
        patterns = (
            ['오프닝 훅/도입 구성 확인 필요', '장면 전개 리듬 분석', '마무리 CTA/엔딩 방식 확인']
            if ctx.get('hasTranscript')
            else ['제목·설명 기반 구성 추정', '영상 구조는 자막 확보 후 재분석 권장', '편집 패턴 추정 정확도 낮음']
        )
    if not ctx.get('hasTranscript') and '메타데이터' not in content_summary:
        content_summary = f'메타데이터 기반 분석: {content_summary}'
    if not ctx.get('hasTranscript') and '메타데이터' not in delivery_summary:
        delivery_summary = f'메타데이터 기반 분석: {delivery_summary}'

    return JsonResponse({
        'summary': delivery_summary,
        'patterns': patterns[:12],
        'content': {
            'summary': content_summary,
            'keyPoints': content_key_points[:14],
        },
        'delivery': {
            'summary': delivery_summary,
            'patterns': patterns[:12],
        },
        'meta': {
            'provider': 'fal-openrouter',
            'analysisMode': 'metadata-transcript-fallback',
            'contentAnalysisMode': 'metadata-transcript-fallback',
            'deliveryAnalysisMode': 'metadata-transcript-fallback',
            'directVideoAttempted': bool(direct_video_enabled),
            'directVideoError': direct_video_error,
            'model': (
                requested_model
                or config('OPENROUTER_BENCHMARK_MODEL', default='google/gemini-2.5-flash')
                or config('GEMINI_BENCHMARK_MODEL', default='google/gemini-2.5-flash')
                or 'google/gemini-2.5-flash'
            ),
            'hasTranscript': bool(ctx.get('hasTranscript')),
            'durationSeconds': ctx.get('durationSeconds'),
            'videoId': ctx.get('videoId') or '',
            'title': ctx.get('title') or '',
            'channel': ctx.get('channel') or '',
            'source': ctx.get('source') or {},
        },
    })


# YouTube categoryId: 인기=브이로그·엔터·하우투·코미디·음악, 틈새=교육·과학·게임
TREND_CATEGORY_MAINSTREAM = ('22', '24', '26', '23', '10')  # People, Entertainment, Howto, Comedy, Music
TREND_CATEGORY_NICHE = ('27', '28', '20')  # Education, Science/Tech, Gaming


@require_GET
def youtube_trending(request):
    """한국 인기 영상 조회수 순. template=mainstream|niche 로 시장 카테고리 필터."""
    api_key = config('YOUTUBE_API_KEY', default='')
    if not api_key:
        # 200 + error so frontend can show specific message
        return JsonResponse({'items': [], 'error': 'YOUTUBE_API_KEY not configured'})

    try:
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
    except ImportError:
        return JsonResponse({
            'weekly': [],
            'monthly': [],
            'error': 'google-api-python-client not installed',
        }, status=503)

    template = (request.GET.get('template') or 'all').strip().lower()
    if template not in ('all', 'mainstream', 'niche'):
        template = 'all'
    is_all = template == 'all'
    allowed_categories = None if is_all else (TREND_CATEGORY_MAINSTREAM if template == 'mainstream' else TREND_CATEGORY_NICHE)

    # 선택 칩용: category_id 쿼리 있으면 해당 카테고리만 반환 (전체 50개 조회 후 필터)
    # API 계약: category_id=25 또는 category_id=25,26 (콤마 구분, YouTube video categoryId 문자열)
    category_id_param = (
        request.GET.get('category_id') or request.GET.get('categoryId') or ''
    ).strip()
    filter_category_ids = None
    if category_id_param:
        raw_ids = [x.strip() for x in category_id_param.split(',') if x.strip()]
        filter_category_ids = [str(cid) for cid in raw_ids] if raw_ids else None

    try:
        youtube = build('youtube', 'v3', developerKey=api_key)
        videos = []

        if filter_category_ids:
            # 칩 선택 시: 카테고리별 인기 차트를 YouTube에 직접 요청. KR에서 미지원 카테고리(404)는 전체 50개 조회 후 필터로 폴백
            seen_ids = set()
            fallback_cat_ids = []  # videoCategoryId 요청 시 404 난 카테고리 (지역별 미지원)
            for cat_id in filter_category_ids:
                try:
                    trend_req = youtube.videos().list(
                        part='snippet,statistics',
                        chart='mostPopular',
                        regionCode='KR',
                        maxResults=50,
                        videoCategoryId=cat_id,
                    )
                    trend_res = trend_req.execute()
                    for item in trend_res.get('items', []):
                        vid = item.get('id')
                        if vid in seen_ids:
                            continue
                        seen_ids.add(vid)
                        snippet = item.get('snippet', {})
                        raw_cat = snippet.get('categoryId')
                        category_id = str(raw_cat).strip() if raw_cat is not None else ''
                        title = snippet.get('title', '')
                        channel = snippet.get('channelTitle', '')
                        view_count = int(item.get('statistics', {}).get('viewCount', 0))
                        thumb = (snippet.get('thumbnails') or {}).get('high', {}).get('url') or ''
                        videos.append({
                            'title': title,
                            'channel': channel,
                            'videoId': vid,
                            'viewCount': view_count,
                            'thumbnail': thumb,
                            'categoryId': category_id,
                        })
                except Exception as e:
                    err_str = str(e)
                    status = getattr(getattr(e, 'resp', None), 'status', None) if hasattr(e, 'resp') else None
                    is_404 = (
                        status == 404
                        or (isinstance(status, str) and status == '404')
                        or ('404' in err_str and 'notFound' in err_str)
                        or 'Requested entity was not found' in err_str
                    )
                    if is_404:
                        fallback_cat_ids.append(cat_id)
                    else:
                        raise
            if fallback_cat_ids:
                trend_req = youtube.videos().list(
                    part='snippet,statistics',
                    chart='mostPopular',
                    regionCode='KR',
                    maxResults=50,
                )
                trend_res = trend_req.execute()
                for item in trend_res.get('items', []):
                    snippet = item.get('snippet', {})
                    raw_cat = snippet.get('categoryId')
                    category_id = str(raw_cat).strip() if raw_cat is not None else ''
                    if category_id not in fallback_cat_ids:
                        continue
                    vid = item.get('id')
                    if vid in seen_ids:
                        continue
                    seen_ids.add(vid)
                    title = snippet.get('title', '')
                    channel = snippet.get('channelTitle', '')
                    view_count = int(item.get('statistics', {}).get('viewCount', 0))
                    thumb = (snippet.get('thumbnails') or {}).get('high', {}).get('url') or ''
                    videos.append({
                        'title': title,
                        'channel': channel,
                        'videoId': vid,
                        'viewCount': view_count,
                        'thumbnail': thumb,
                        'categoryId': category_id,
                    })
            videos.sort(key=lambda x: x['viewCount'], reverse=True)
            if len(videos) > 50:
                videos = videos[:50]
        else:
            trend_req = youtube.videos().list(
                part='snippet,statistics',
                chart='mostPopular',
                regionCode='KR',
                maxResults=50,
            )
            trend_res = trend_req.execute()
            items = trend_res.get('items', [])

            for item in items:
                snippet = item.get('snippet', {})
                raw_cat = snippet.get('categoryId')
                category_id = str(raw_cat).strip() if raw_cat is not None else ''
                if not is_all and category_id not in allowed_categories:
                    continue
                vid = item['id']
                title = snippet.get('title', '')
                channel = snippet.get('channelTitle', '')
                view_count = int(item.get('statistics', {}).get('viewCount', 0))
                thumb = (snippet.get('thumbnails') or {}).get('high', {}).get('url') or ''
                videos.append({
                    'title': title,
                    'channel': channel,
                    'videoId': vid,
                    'viewCount': view_count,
                    'thumbnail': thumb,
                    'categoryId': category_id,
                })
            videos.sort(key=lambda x: x['viewCount'], reverse=True)

        if is_all or filter_category_ids is not None:
            # 전체 또는 칩(categoryId) 선택 시: items 배열로 반환
            return JsonResponse({
                'items': [
                    {'name': v['title'], 'viewCount': v['viewCount'], 'videoId': v['videoId'], 'channel': v['channel'], 'categoryId': v['categoryId']}
                    for v in videos
                ],
            })
        top_20 = videos[:20]
        weekly = [
            {'name': v['title'], 'viewCount': v['viewCount'], 'videoId': v['videoId'], 'channel': v['channel']}
            for v in top_20[:10]
        ]
        monthly = [
            {'name': v['title'], 'viewCount': v['viewCount'], 'videoId': v['videoId'], 'channel': v['channel']}
            for v in top_20[10:20]
        ]
        return JsonResponse({'weekly': weekly, 'monthly': monthly})
    except Exception as e:
        return JsonResponse({
            'weekly': [],
            'monthly': [],
            'error': str(e),
        }, status=502)


# ----- Studio fal API (LLM, Image, TTS) -----


def _parse_json_body(request):
    try:
        return json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return None


@csrf_exempt
@ratelimit(key='ip', rate='30/m', method='POST', block=False)
@require_http_methods(['POST'])
def studio_llm(request):
    """Studio Step 2~4 LLM. POST JSON: { prompt, system_prompt?, model?, provider?, google_search?, response_mime_type?, response_schema? } -> { output }."""
    if (r := _check_ratelimit(request)):
        return r
    body = _parse_json_body(request)
    if not body or not isinstance(body.get('prompt'), str):
        return JsonResponse({'error': 'prompt (string) required'}, status=400)
    try:
        from apps.ai.fal_client import chat_completion
        from apps.ai.errors import FALError
    except ImportError as e:
        logger.exception('studio_llm import')
        return JsonResponse({'error': str(e)}, status=503)
    prompt = (body.get('prompt') or '').strip()
    if not prompt:
        return JsonResponse({'error': 'prompt required'}, status=400)
    if len(prompt) > STUDIO_LLM_PROMPT_MAX:
        return JsonResponse({'error': f'prompt는 {STUDIO_LLM_PROMPT_MAX}자 이내로 입력해 주세요.'}, status=400)
    system_prompt = body.get('system_prompt') or None
    if system_prompt is not None and not isinstance(system_prompt, str):
        system_prompt = None
    if system_prompt and len(system_prompt) > STUDIO_LLM_SYSTEM_MAX:
        return JsonResponse({'error': f'system_prompt는 {STUDIO_LLM_SYSTEM_MAX}자 이내로 입력해 주세요.'}, status=400)
    model = body.get('model') or 'google/gemini-2.5-flash'
    provider = (body.get('provider') or '').strip().lower()
    google_search = bool(body.get('google_search'))
    response_mime_type = body.get('response_mime_type') if isinstance(body.get('response_mime_type'), str) else None
    response_schema = body.get('response_schema') if isinstance(body.get('response_schema'), dict) else None
    try:
        if provider == 'google-ai-studio':
            output = _gemini_generate_text(
                prompt,
                system_prompt=system_prompt,
                model=model,
                google_search=google_search,
                response_mime_type=response_mime_type,
                response_schema=response_schema,
            )
            return JsonResponse({'output': output or ''})
        output = chat_completion(prompt, model=model, system_prompt=system_prompt)
        return JsonResponse({'output': output or ''})
    except FALError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except RuntimeError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('studio_llm')
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@ratelimit(key='ip', rate='15/m', method='POST', block=False)
@require_http_methods(['POST'])
def studio_image(request):
    """Studio scene image. POST JSON: { prompt, model?, aspect_ratio?, num_images? } -> { images }."""
    if (r := _check_ratelimit(request)):
        return r
    body = _parse_json_body(request)
    if not body or not isinstance(body.get('prompt'), str):
        return JsonResponse({'error': 'prompt (string) required'}, status=400)
    try:
        from apps.ai.fal_client import image_generation_fal
        from apps.ai.errors import FALError
    except ImportError as e:
        logger.exception('studio_image import')
        return JsonResponse({'error': str(e)}, status=503)
    prompt = (body.get('prompt') or '').strip()
    if not prompt:
        return JsonResponse({'error': 'prompt required'}, status=400)
    if len(prompt) > STUDIO_IMAGE_PROMPT_MAX:
        return JsonResponse({'error': f'prompt는 {STUDIO_IMAGE_PROMPT_MAX}자 이내로 입력해 주세요.'}, status=400)
    model = body.get('model') or 'fal-ai/imagen4/preview'
    aspect_ratio = body.get('aspect_ratio') or '16:9'
    num_images = max(1, min(4, int(body.get('num_images', 1))))
    kwargs = {}
    if body.get('seed') is not None:
        kwargs['seed'] = body['seed']
    if body.get('reference_image_url'):
        kwargs['reference_image_url'] = body['reference_image_url']
    image_urls = body.get('image_urls')
    if isinstance(image_urls, list):
        clean_urls = [u.strip() for u in image_urls if isinstance(u, str) and u.strip()]
        if clean_urls:
            kwargs['image_urls'] = clean_urls[:14]
    if body.get('resolution'):
        kwargs['resolution'] = body['resolution']
    if body.get('output_format'):
        kwargs['output_format'] = body['output_format']
    if body.get('limit_generations') is not None:
        kwargs['limit_generations'] = bool(body.get('limit_generations'))
    if body.get('enable_web_search') is not None:
        kwargs['enable_web_search'] = bool(body.get('enable_web_search'))
    try:
        images = image_generation_fal(prompt, model=model, aspect_ratio=aspect_ratio, num_images=num_images, **kwargs)
        return JsonResponse({'images': images})
    except FALError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('studio_image')
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@ratelimit(key='ip', rate='20/m', method='POST', block=False)
@require_http_methods(['POST'])
def studio_video_prompt(request):
    """Video prompt builder. POST JSON -> { prompt, model }."""
    if (r := _check_ratelimit(request)):
        return r
    body = _parse_json_body(request)
    if not body or not isinstance(body.get('input_concept'), str):
        return JsonResponse({'error': 'input_concept (string) required'}, status=400)
    try:
        from apps.ai.fal_client import generate_video_prompt_fal
        from apps.ai.errors import FALError
    except ImportError as e:
        logger.exception('studio_video_prompt import')
        return JsonResponse({'error': str(e)}, status=503)

    input_concept = (body.get('input_concept') or '').strip()
    if not input_concept:
        return JsonResponse({'error': 'input_concept required'}, status=400)
    if len(input_concept) > STUDIO_VIDEO_PROMPT_MAX:
        return JsonResponse({'error': f'input_concept는 {STUDIO_VIDEO_PROMPT_MAX}자 이내로 입력해 주세요.'}, status=400)

    prompt_length = (body.get('prompt_length') or 'medium').strip().lower() if isinstance(body.get('prompt_length'), str) else 'medium'
    if prompt_length not in ('short', 'medium', 'long'):
        prompt_length = 'medium'

    def _clean_optional_text(key: str, max_length: int = 500) -> str | None:
        value = body.get(key)
        if not isinstance(value, str):
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        return cleaned[:max_length]

    try:
        result = generate_video_prompt_fal(
            input_concept,
            style=_clean_optional_text('style'),
            camera_style=_clean_optional_text('camera_style'),
            camera_direction=_clean_optional_text('camera_direction'),
            pacing=_clean_optional_text('pacing'),
            special_effects=_clean_optional_text('special_effects'),
            custom_elements=_clean_optional_text('custom_elements', max_length=1_500),
            model=_clean_optional_text('model', max_length=120),
            prompt_length=prompt_length,
        )
        return JsonResponse(result)
    except FALError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('studio_video_prompt')
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@ratelimit(key='ip', rate='30/m', method='POST', block=False)
@require_http_methods(['POST'])
def studio_bg_remove(request):
    """Studio Reference Step: background removal. POST JSON: { image_url, crop_to_bbox? } -> { image }."""
    if (r := _check_ratelimit(request)):
        return r
    body = _parse_json_body(request)
    if not body or not isinstance(body.get('image_url'), str):
        return JsonResponse({'error': 'image_url (string) required'}, status=400)
    image_url = (body.get('image_url') or '').strip()
    if not image_url:
        return JsonResponse({'error': 'image_url required'}, status=400)
    crop_to_bbox = bool(body.get('crop_to_bbox', False))
    try:
        from apps.ai.fal_client import remove_background_fal
        from apps.ai.errors import FALError
    except ImportError as e:
        logger.exception('studio_bg_remove import')
        return JsonResponse({'error': str(e)}, status=503)
    try:
        image = remove_background_fal(image_url, crop_to_bbox=crop_to_bbox)
        return JsonResponse({'image': image})
    except FALError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('studio_bg_remove')
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@ratelimit(key='ip', rate='60/m', method='POST', block=False)
@require_http_methods(['POST'])
def studio_tts(request):
    """Studio Step 6 TTS. POST JSON: { text, voice?, speed?, language_code?, stability?, similarity_boost?, style?, previous_text?, next_text? } -> { url, duration_ms }."""
    if (r := _check_ratelimit(request)):
        return r
    body = _parse_json_body(request)
    if not body or not isinstance(body.get('text'), str):
        return JsonResponse({'error': 'text (string) required'}, status=400)
    try:
        from apps.ai.fal_client import tts_elevenlabs
        from apps.ai.errors import FALError
    except ImportError as e:
        logger.exception('studio_tts import')
        return JsonResponse({'error': str(e)}, status=503)
    text = (body.get('text') or '').strip()
    if not text:
        return JsonResponse({'error': 'text required'}, status=400)
    if len(text) > STUDIO_TTS_TEXT_MAX:
        return JsonResponse({'error': f'text는 {STUDIO_TTS_TEXT_MAX}자 이내로 입력해 주세요.'}, status=400)
    voice = body.get('voice') or 'Jessica'
    speed = body.get('speed')
    if speed is not None:
        try:
            speed = float(speed)
        except (TypeError, ValueError):
            speed = 1.0
    else:
        speed = 1.0
    language_code = body.get('language_code') if isinstance(body.get('language_code'), str) else 'ko'
    stability = body.get('stability')
    try:
        stability = float(stability) if stability is not None else 0.45
    except (TypeError, ValueError):
        stability = 0.45
    similarity_boost = body.get('similarity_boost')
    try:
        similarity_boost = float(similarity_boost) if similarity_boost is not None else 0.8
    except (TypeError, ValueError):
        similarity_boost = 0.8
    style = body.get('style')
    try:
        style = float(style) if style is not None else 0.2
    except (TypeError, ValueError):
        style = 0.2
    previous_text = body.get('previous_text') if isinstance(body.get('previous_text'), str) else None
    next_text = body.get('next_text') if isinstance(body.get('next_text'), str) else None
    try:
        result = tts_elevenlabs(
            text,
            voice=voice,
            speed=speed,
            language_code=language_code,
            stability=stability,
            similarity_boost=similarity_boost,
            style=style,
            previous_text=previous_text,
            next_text=next_text,
        )
        return JsonResponse(result)
    except FALError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('studio_tts')
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_http_methods(['POST'])
def studio_export(request):
    """
    Studio Step 6: Render MP4 (image+audio) and optional captions.
    POST JSON:
      {
        "session_id": number,
        "aspect_ratio": "9:16" | "16:9",
        "fps": number?,
        "subtitles_enabled": boolean?,
        "burn_in_subtitles": boolean?,
        "scenes": [
          { "image_url": string, "audio_url": string, "text": string?, "duration_sec": number? }
        ]
      }
    -> { task_id, job_id }
    """
    body = _parse_json_body(request)
    if not body:
        return JsonResponse({'error': 'invalid JSON body'}, status=400)

    session_id = body.get('session_id')
    if not isinstance(session_id, int):
        try:
            session_id = int(session_id)
        except Exception:
            session_id = None
    if not session_id:
        return JsonResponse({'error': 'session_id (number) required'}, status=400)

    aspect_ratio = (body.get('aspect_ratio') or '16:9').strip()
    if aspect_ratio not in ('9:16', '16:9'):
        aspect_ratio = '16:9'

    fps = body.get('fps', 30)
    try:
        fps = int(fps)
    except Exception:
        fps = 30
    fps = max(10, min(60, fps))

    subtitles_enabled = body.get('subtitles_enabled', True)
    burn_in_subtitles = body.get('burn_in_subtitles', False)
    subtitles_enabled = bool(subtitles_enabled)
    burn_in_subtitles = bool(burn_in_subtitles)

    scenes = body.get('scenes') or []
    if not isinstance(scenes, list):
        return JsonResponse({'error': 'scenes must be an array'}, status=400)

    try:
        from apps.chats.models import Session, Job, SESSION_KIND_STUDIO
        from .tasks import task_studio_export
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=503)

    try:
        session = Session.objects.get(pk=session_id)
    except Session.DoesNotExist:
        return JsonResponse({'error': 'session not found'}, status=404)
    if session.kind != SESSION_KIND_STUDIO:
        return JsonResponse({'error': 'not a studio session'}, status=400)

    job = Job.objects.create(session=session, kind='studio_export', status='pending', result={})
    task = task_studio_export.delay(
        job.id,
        aspect_ratio=aspect_ratio,
        scenes=scenes,
        subtitles_enabled=subtitles_enabled,
        burn_in_subtitles=burn_in_subtitles,
        fps=fps,
    )
    job.task_id = task.id
    job.save(update_fields=['task_id', 'updated_at'])
    return JsonResponse({'task_id': task.id, 'job_id': job.id}, status=202)


@require_GET
def studio_export_job_status(request, task_id: str):
    try:
        from apps.chats.models import Job
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=503)

    try:
        job = Job.objects.get(task_id=task_id)
    except Job.DoesNotExist:
        return JsonResponse({'error': 'job not found'}, status=404)

    payload = {
        'task_id': task_id,
        'job_id': job.id,
        'kind': job.kind,
        'status': job.status,
        'result': job.result or {},
    }
    if job.status == 'failure':
        payload['error'] = job.error_message
    return JsonResponse(payload)


@csrf_exempt
@require_http_methods(['POST'])
def studio_export_job_cancel(request, task_id: str):
    try:
        from celery import current_app
        try:
            from apps.chats.models import Job
            Job.objects.filter(task_id=task_id).update(status='failure', error_message='cancelled', result={})
        except Exception:
            pass
        current_app.control.revoke(task_id, terminate=True)
        return JsonResponse({'status': 'cancelled'})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@ratelimit(key='ip', rate='12/m', method='POST', block=False)
@require_http_methods(['POST'])
def studio_thumbnail_benchmark(request):
    """
    Studio Step 9 async thumbnail benchmark.
    POST JSON: { session_id, reference_thumbnail_url, target_topic, aspect_ratio, num_candidates? }
    -> { task_id, job_id }
    """
    if (r := _check_ratelimit(request)):
        return r
    body = _parse_json_body(request)
    session_id = body.get('session_id')
    if not isinstance(session_id, int):
        try:
            session_id = int(session_id)
        except Exception:
            session_id = None
    reference_thumbnail_url = (body.get('reference_thumbnail_url') or '').strip() if isinstance(body.get('reference_thumbnail_url'), str) else ''
    target_topic = (body.get('target_topic') or '').strip() if isinstance(body.get('target_topic'), str) else ''
    aspect_ratio = (body.get('aspect_ratio') or '16:9').strip()
    num_candidates = body.get('num_candidates', 3)
    try:
        num_candidates = int(num_candidates)
    except Exception:
        num_candidates = 3
    num_candidates = max(1, min(4, num_candidates))

    if not session_id:
        return JsonResponse({'error': 'session_id (number) required'}, status=400)
    if not reference_thumbnail_url:
        return JsonResponse({'error': 'reference_thumbnail_url required'}, status=400)
    if not target_topic:
        return JsonResponse({'error': 'target_topic required'}, status=400)
    if aspect_ratio not in ('9:16', '16:9'):
        aspect_ratio = '16:9'

    try:
        from apps.chats.models import Session, Job, SESSION_KIND_STUDIO
        from .tasks import task_studio_thumbnail_benchmark
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=503)

    try:
        session = Session.objects.get(pk=session_id)
    except Session.DoesNotExist:
        return JsonResponse({'error': 'session not found'}, status=404)
    if session.kind != SESSION_KIND_STUDIO:
        return JsonResponse({'error': 'not a studio session'}, status=400)

    job = Job.objects.create(session=session, kind='studio_thumb_bench', status='pending', result={})
    task = task_studio_thumbnail_benchmark.delay(
        job.id,
        reference_thumbnail_url=reference_thumbnail_url,
        target_topic=target_topic,
        aspect_ratio=aspect_ratio,
        num_candidates=num_candidates,
    )
    job.task_id = task.id
    job.save(update_fields=['task_id', 'updated_at'])
    return JsonResponse({'task_id': task.id, 'job_id': job.id}, status=202)


@require_GET
def studio_thumbnail_benchmark_job_status(request, task_id: str):
    try:
        from apps.chats.models import Job
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=503)

    try:
        job = Job.objects.get(task_id=task_id)
    except Job.DoesNotExist:
        return JsonResponse({'error': 'job not found'}, status=404)

    payload = {
        'task_id': task_id,
        'job_id': job.id,
        'kind': job.kind,
        'status': job.status,
        'result': job.result or {},
    }
    if job.status == 'failure':
        payload['error'] = job.error_message
    return JsonResponse(payload)


@csrf_exempt
@ratelimit(key='ip', rate='10/m', method='POST', block=False)
@require_http_methods(['POST'])
def studio_video(request):
    """Studio Step 6 영상 합성. POST JSON: { clips: [{ image_url, audio_url, duration_sec }], aspect_ratio? } -> { video_url, thumbnail_url? }."""
    if (r := _check_ratelimit(request)):
        return r
    body = _parse_json_body(request)
    if not body or not isinstance(body.get('clips'), list):
        return JsonResponse({'error': 'clips (array) required'}, status=400)
    clips = body.get('clips', [])
    if not clips:
        return JsonResponse({'error': 'clips must not be empty'}, status=400)
    for i, c in enumerate(clips):
        if not isinstance(c, dict) or not c.get('image_url') or not c.get('audio_url'):
            return JsonResponse({'error': f'clip[{i}] must have image_url and audio_url'}, status=400)
    aspect_ratio = (body.get('aspect_ratio') or '9:16').strip() or '9:16'
    try:
        from apps.ai.fal_client import ffmpeg_compose_video
        from apps.ai.errors import FALError
    except ImportError as e:
        logger.exception('studio_video import')
        return JsonResponse({'error': str(e)}, status=503)
    try:
        result = ffmpeg_compose_video(clips=clips, aspect_ratio=aspect_ratio)
        return JsonResponse(result)
    except FALError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('studio_video')
        return JsonResponse({'error': str(e)}, status=500)
