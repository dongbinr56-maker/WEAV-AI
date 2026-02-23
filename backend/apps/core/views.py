import json
import logging

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
STUDIO_TTS_TEXT_MAX = 5_000

# SPA에서 쿠키 기반 세션 미사용 시 csrf_exempt 필요. 인증 추가 시 CSRF 토큰 처리로 전환 권장.

def _check_ratelimit(request):
    """django-ratelimit block=False 사용 시, 제한 초과 시 429 반환."""
    if getattr(request, 'limited', False):
        return JsonResponse(
            {'error': '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'}, status=429
        )
    return None


def health(request):
    return JsonResponse({'status': 'ok'})


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
    """Studio Step 2~4 LLM. POST JSON: { prompt, system_prompt?, model? } -> { output }."""
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
    try:
        output = chat_completion(prompt, model=model, system_prompt=system_prompt)
        return JsonResponse({'output': output or ''})
    except FALError as e:
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
    try:
        images = image_generation_fal(prompt, model=model, aspect_ratio=aspect_ratio, num_images=num_images, **kwargs)
        return JsonResponse({'images': images})
    except FALError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('studio_image')
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@ratelimit(key='ip', rate='60/m', method='POST', block=False)
@require_http_methods(['POST'])
def studio_tts(request):
    """Studio Step 5 TTS. POST JSON: { text, voice_id? } -> { url, duration_ms }."""
    if (r := _check_ratelimit(request)):
        return r
    body = _parse_json_body(request)
    if not body or not isinstance(body.get('text'), str):
        return JsonResponse({'error': 'text (string) required'}, status=400)
    try:
        from apps.ai.fal_client import tts_minimax
        from apps.ai.errors import FALError
    except ImportError as e:
        logger.exception('studio_tts import')
        return JsonResponse({'error': str(e)}, status=503)
    text = (body.get('text') or '').strip()
    if not text:
        return JsonResponse({'error': 'text required'}, status=400)
    if len(text) > STUDIO_TTS_TEXT_MAX:
        return JsonResponse({'error': f'text는 {STUDIO_TTS_TEXT_MAX}자 이내로 입력해 주세요.'}, status=400)
    voice_id = body.get('voice_id') or 'Wise_Woman'
    speed = body.get('speed')
    if speed is not None:
        try:
            speed = float(speed)
        except (TypeError, ValueError):
            speed = 1.0
    else:
        speed = 1.0
    try:
        result = tts_minimax(text, voice_id=voice_id, speed=speed, output_format='url')
        return JsonResponse(result)
    except FALError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('studio_tts')
        return JsonResponse({'error': str(e)}, status=500)


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
