"""
fal.ai HTTP API: openrouter/router (chat), imagen4 (Google), flux-pro v1.1-ultra (FLUX), Kling.
참고: 00_docs/imagen4-preview.txt, 00_docs/flux-pro_v1.1-ultra.txt
"""
import base64
import re
import logging
import mimetypes
import os
import shutil
import subprocess
import tempfile
from typing import Optional
from urllib.parse import urlparse, urlunparse, unquote
import ipaddress

import requests
from .errors import FALError

FAL_BASE = 'https://fal.run'
FAL_QUEUE_BASE = 'https://queue.fal.run'
# 채팅: openrouter/router (any-llm deprecated 대체)
FAL_CHAT_ENDPOINT = 'openrouter/router'
# Imagen 4 (Google): aspect_ratio "1:1"|"16:9"|"9:16"|"4:3"|"3:4", resolution "1K"|"2K", output_format png|jpeg|webp
FAL_IMAGEN4 = 'fal-ai/imagen4/preview'
# FLUX Pro v1.1 Ultra: aspect_ratio "21:9"|"16:9"|"4:3"|"3:2"|"1:1"|"2:3"|"3:4"|"9:16"|"9:21", output_format jpeg|png
FAL_FLUX_ULTRA = 'fal-ai/flux-pro/v1.1-ultra'
# Kling (Placeholder endpoint)
FAL_KLING = 'kling-ai/kling-v1'
# Gemini 3 Pro Image Preview (Google, Nano Banana Pro): text-to-image
FAL_GEMINI3_PRO_IMAGE = 'fal-ai/gemini-3-pro-image-preview'
# Gemini 3 Pro Image Preview Edit: image_urls required, up to 2 ref images
FAL_GEMINI3_PRO_IMAGE_EDIT = 'fal-ai/gemini-3-pro-image-preview/edit'
# Nano Banana 2
FAL_NANO_BANANA_2 = 'fal-ai/nano-banana-2'
FAL_NANO_BANANA_2_EDIT = 'fal-ai/nano-banana-2/edit'
# Backward-compatible aliases used elsewhere in the backend.
FAL_NANO_BANANA_PRO = FAL_NANO_BANANA_2
FAL_NANO_BANANA_PRO_EDIT = FAL_NANO_BANANA_2_EDIT
FAL_IMAGEUTILS_REMBG = 'fal-ai/imageutils/rembg'

logger = logging.getLogger(__name__)

try:
    from storage.s3 import minio_client
except Exception:
    minio_client = None


def _fal_headers():
    key = os.environ.get('FAL_KEY', '')
    if not key:
        raise FALError('FAL_KEY not set')
    return {'Authorization': f'Key {key}', 'Content-Type': 'application/json'}


def _fal_auth_header() -> dict:
    key = os.environ.get('FAL_KEY', '')
    if not key:
        raise FALError('FAL_KEY not set')
    return {'Authorization': f'Key {key}'}


# UI/레거시 모델 ID → OpenRouter에서 실제 지원되는 ID로 매핑
MODEL_ALIASES = {
    'openai/gpt-5-chat': 'openai/gpt-4.1',
    'openai/gpt-4o': 'openai/gpt-4.1',
    'openai/gpt-4o-mini': 'openai/gpt-4.1',
    'google/gemini-2.5-pro': 'google/gemini-2.5-flash',
}


def _normalize_openrouter_model(model: str) -> str:
    m = (model or '').strip() or 'google/gemini-2.5-flash'
    return MODEL_ALIASES.get(m, m)


def _extract_error_message(resp: requests.Response) -> str:
    try:
        data = resp.json()
        if isinstance(data, dict):
            return data.get('detail') or data.get('error') or data.get('message') or str(data)
        return str(data)
    except Exception:
        return resp.text or resp.reason or f'HTTP {resp.status_code}'


def _openrouter_queue_submit(payload: dict, timeout: int = 30) -> dict:
    url = f'{FAL_QUEUE_BASE}/{FAL_CHAT_ENDPOINT}'
    headers = {**_fal_auth_header(), 'Content-Type': 'application/json'}
    r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    if not r.ok:
        msg = _extract_error_message(r)
        logger.warning("fal openrouter queue submit %s: status=%s body=%s", url, r.status_code, msg)
        raise FALError(f'OpenRouter 요청 실패 ({r.status_code}): {msg}')
    return r.json() if r.content else {}


def _openrouter_queue_poll(request_id: str, timeout_sec: int = 120, poll_interval_sec: float = 0.6) -> None:
    import time
    start = time.time()
    headers = _fal_auth_header()
    logs = '1' if _fal_debug_enabled() else '0'
    status_url = f'{FAL_QUEUE_BASE}/{FAL_CHAT_ENDPOINT}/requests/{request_id}/status?logs={logs}'
    while True:
        if time.time() - start > max(1, timeout_sec):
            raise FALError('OpenRouter 응답 대기 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.')
        r = requests.get(status_url, headers=headers, timeout=20)
        if not r.ok:
            msg = _extract_error_message(r)
            logger.warning("fal openrouter queue status %s: status=%s body=%s", status_url, r.status_code, msg)
            raise FALError(f'OpenRouter 상태 조회 실패 ({r.status_code}): {msg}')
        data = r.json() if r.content else {}
        status = (data.get('status') or '').upper()
        if status == 'COMPLETED':
            return
        if status in ('FAILED', 'FAILURE', 'ERROR'):
            logs = data.get('logs')
            detail = ''
            if isinstance(logs, dict):
                # best-effort extraction
                detail = str(logs.get('message') or logs.get('error') or '').strip()
            raise FALError(f'OpenRouter 요청이 실패했습니다.{f" {detail}" if detail else ""}')
        if status in ('IN_QUEUE', 'IN_PROGRESS'):
            time.sleep(max(0.2, float(poll_interval_sec)))
            continue
        logger.warning("fal openrouter queue unknown status: %s", data)
        raise FALError(f'OpenRouter 상태가 올바르지 않습니다: {status or "unknown"}')


def _openrouter_queue_result(request_id: str) -> dict:
    url = f'{FAL_QUEUE_BASE}/{FAL_CHAT_ENDPOINT}/requests/{request_id}'
    headers = _fal_auth_header()
    r = requests.get(url, headers=headers, timeout=30)
    if not r.ok:
        msg = _extract_error_message(r)
        logger.warning("fal openrouter queue result %s: status=%s body=%s", url, r.status_code, msg)
        raise FALError(f'OpenRouter 결과 조회 실패 ({r.status_code}): {msg}')
    return r.json() if r.content else {}


def _is_private_or_local_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = parsed.hostname
        if not host:
            return True
        if host in ('localhost', '127.0.0.1', '0.0.0.0', 'minio', 'api'):
            return True
        try:
            ip = ipaddress.ip_address(host)
            return ip.is_private or ip.is_loopback or ip.is_link_local
        except ValueError:
            return False
    except Exception:
        return True


def _is_ngrok_url(url: str) -> bool:
    """fal.ai 서버에서 접근 불가한 ngrok 터널 등은 백엔드에서 이미지를 받아 Data URI로 넘깁니다."""
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or '').lower()
        return 'ngrok' in host or 'ngrok-free' in host
    except Exception:
        return False


def _fetch_image_as_data_uri(url: str, timeout: int = 30) -> str:
    """URL에서 이미지를 다운로드해 data:image/...;base64,... 형식으로 반환."""
    headers = {}
    if _is_ngrok_url(url):
        headers['Ngrok-Skip-Browser-Warning'] = '1'
    r = requests.get(url, headers=headers, timeout=timeout)
    r.raise_for_status()
    content_type = r.headers.get('Content-Type', 'image/png').split(';')[0].strip()
    if content_type not in ('image/png', 'image/jpeg', 'image/jpg', 'image/webp'):
        content_type = 'image/png'
    b64 = base64.b64encode(r.content).decode('ascii')
    return f'data:{content_type};base64,{b64}'


def _bytes_to_image_data_uri(raw: bytes, filename_hint: str = "") -> str:
    guessed = mimetypes.guess_type(filename_hint)[0] if filename_hint else None
    content_type = guessed or "image/png"
    if content_type not in ("image/png", "image/jpeg", "image/jpg", "image/webp"):
        content_type = "image/png"
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{content_type};base64,{b64}"


def _extract_storage_key_from_url(url: str) -> Optional[str]:
    try:
        parsed = urlparse(url)
        raw_path = (parsed.path or "").strip("/")
        if not raw_path:
            return None
        path = unquote(raw_path)

        # /<bucket>/<key> 형식
        if minio_client is not None:
            bucket = getattr(minio_client, "bucket_name", "")
            prefix = f"{bucket}/"
            if bucket and path.startswith(prefix):
                return path[len(prefix):]

        # /weavai-files/<key> 또는 .../weavai-files/<key>
        marker = "/weavai-files/"
        if marker in f"/{path}":
            return path.split("weavai-files/", 1)[1]

        # 이미 key만 들어온 경우
        if path.startswith("ref_uploads/") or path.startswith("attach_uploads/") or path.startswith("images/"):
            return path
        return None
    except Exception:
        return None


def _fetch_image_from_minio_as_data_uri(url: str) -> Optional[str]:
    if minio_client is None:
        return None
    key = _extract_storage_key_from_url(url)
    if not key:
        return None
    raw = minio_client.get_file_content(key)
    return _bytes_to_image_data_uri(raw, filename_hint=key)


def _get_image_bytes(url: str) -> tuple[bytes, str]:
    """이미지 URL에서 바이트와 content_type 반환. data URI, MinIO, ngrok 등 지원."""
    if not url or not url.strip():
        raise FALError('image url required')
    url = url.strip()
    if url.lower().startswith('data:'):
        try:
            header, b64 = url.split(',', 1)
            ct = 'image/png'
            if ';base64' in header:
                mime = header.split(';')[0].replace('data:', '').strip()
                if mime in ('image/png', 'image/jpeg', 'image/jpg', 'image/webp'):
                    ct = mime
            return base64.b64decode(b64), ct
        except Exception as e:
            raise FALError(f'Invalid data URI: {e}')
    if minio_client:
        key = _extract_storage_key_from_url(url)
        if key:
            raw = minio_client.get_file_content(key)
            ext = (key.split('.')[-1] or 'png').lower()
            ct = 'image/png' if ext in ('png', 'jpg', 'jpeg', 'webp') else mimetypes.guess_type(f'a.{ext}')[0] or 'image/png'
            return raw, ct
    headers = {'Ngrok-Skip-Browser-Warning': '1'} if _is_ngrok_url(url) else {}
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    ct = (r.headers.get('Content-Type') or 'image/png').split(';')[0].strip()
    if ct not in ('image/png', 'image/jpeg', 'image/jpg', 'image/webp'):
        ct = 'image/png'
    return r.content, ct


def _image_to_video_segment(img_url: str, duration_sec: float) -> str:
    """
    이미지를 지정 duration만큼 표시하는 짧은 비디오로 변환 후 fal 스토리지에 업로드.
    fal compose는 이미지 URL의 duration을 무시하고 1프레임으로 처리하므로, 사전 변환이 필요함.
    """
    if not shutil.which('ffmpeg'):
        raise FALError(
            'ffmpeg is not installed. Install it to enable video export: '
            'macOS: brew install ffmpeg, Ubuntu: apt install ffmpeg, Docker: add ffmpeg to your image.'
        )
    try:
        import fal_client
    except ImportError:
        raise FALError('fal-client package required for image-to-video conversion (pip install fal-client)')
    raw, content_type = _get_image_bytes(img_url)
    ext = 'png' if 'png' in content_type else 'jpg' if 'jpeg' in content_type or 'jpg' in content_type else 'webp'
    dur = max(0.1, min(600.0, float(duration_sec)))
    tmp_in = None
    tmp_out = None
    try:
        fd_in, tmp_in = tempfile.mkstemp(suffix=f'.{ext}')
        os.write(fd_in, raw)
        os.close(fd_in)
        fd_out, tmp_out = tempfile.mkstemp(suffix='.mp4')
        os.close(fd_out)
        cmd = [
            'ffmpeg', '-y',
            '-loop', '1', '-i', tmp_in,
            '-t', str(dur),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
            '-an',
            tmp_out,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            logger.warning('ffmpeg stderr: %s', result.stderr[:500] if result.stderr else '')
            raise FALError(f'FFmpeg image-to-video failed: {result.stderr[:300] if result.stderr else "unknown"}')
        if not os.path.exists(tmp_out) or os.path.getsize(tmp_out) == 0:
            raise FALError('FFmpeg produced empty video')
        url = fal_client.upload_file(tmp_out)
        return url
    finally:
        for p in (tmp_in, tmp_out):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except Exception:
                    pass


def _ensure_fal_reachable_image_url(url: str) -> str:
    """
    fal.ai가 접근할 수 없는 URL(ngrok, localhost 등)이면
    백엔드에서 이미지를 받아 Data URI로 변환해 반환. fal은 image_urls에 Data URI 지원.
    """
    if not url or not url.strip():
        return url
    if url.strip().lower().startswith('data:'):
        return url
    if _is_private_or_local_url(url) or _is_ngrok_url(url):
        try:
            from_minio = _fetch_image_from_minio_as_data_uri(url)
            if from_minio:
                return from_minio
            return _fetch_image_as_data_uri(url)
        except Exception as e:
            logger.warning("Failed to convert private image URL to data URI for fal: %s", e)
            raise FALError(
                "첨부/참조 이미지 URL을 fal이 읽을 수 없습니다. "
                "공개 접근 가능한 URL을 사용하거나 서버에서 Data URI 변환이 가능한지 확인하세요."
            )
    return url


def _require_public_urls(urls: list[str], label: str):
    for u in urls:
        if _is_private_or_local_url(u):
            raise FALError(
                f'{label} must be publicly accessible URLs. Got: {u}. '
                'Use a public object storage/CDN or presigned URL.'
            )


def _fal_debug_enabled() -> bool:
    return os.environ.get('FAL_DEBUG', '').strip().lower() in ('1', 'true', 'yes', 'on')


def _mask_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        return urlunparse(parsed._replace(query='', fragment=''))
    except Exception:
        return url


def _sanitize_payload(payload: dict) -> dict:
    safe = dict(payload)
    prompt = safe.get('prompt')
    if isinstance(prompt, str) and len(prompt) > 300:
        safe['prompt'] = prompt[:300] + f'... (len={len(prompt)})'
    if isinstance(safe.get('image_urls'), list):
        safe['image_urls'] = [_mask_url(u) for u in safe['image_urls']]
    return safe


def chat_completion(prompt: str, model: str = 'google/gemini-2.5-flash', system_prompt: Optional[str] = None, temperature: float = 0.7, max_tokens: Optional[int] = None) -> str:
    model = _normalize_openrouter_model(model)
    payload = {
        'prompt': (prompt or '').strip(),
        'model': model,
        'temperature': max(0, min(2, temperature)),
        'reasoning': False,
    }
    if system_prompt:
        payload['system_prompt'] = system_prompt
    if max_tokens is not None:
        payload['max_tokens'] = max(1, max_tokens)
    if not payload['prompt']:
        raise FALError('prompt is required')
    queue = _openrouter_queue_submit(payload)
    request_id = queue.get('request_id')
    if not request_id:
        raise FALError('OpenRouter 요청 ID를 받지 못했습니다.')
    if _fal_debug_enabled():
        logger.info('fal openrouter queue request_id=%s payload=%s', request_id, _sanitize_payload(payload))
    timeout_sec = int(os.environ.get('FAL_OPENROUTER_TIMEOUT_SEC', '120') or '120')
    poll_interval = float(os.environ.get('FAL_OPENROUTER_POLL_SEC', '0.6') or '0.6')
    _openrouter_queue_poll(request_id, timeout_sec=timeout_sec, poll_interval_sec=poll_interval)
    result = _openrouter_queue_result(request_id)
    err = result.get('error')
    if err:
        raise FALError(str(err))
    output = result.get('output')
    if output is None:
        raise FALError('OpenRouter 응답이 비어 있습니다.')
    return output if isinstance(output, str) else str(output)


def image_generation_fal(prompt: str, model: str = FAL_IMAGEN4, aspect_ratio: str = '1:1', num_images: int = 1, **kwargs) -> list[dict]:
    """
    fal.ai 이미지 생성.
    - Imagen 4: aspect_ratio "1:1"|"16:9"|"9:16"|"4:3"|"3:4", num_images 1~4
    - FLUX Pro v1.1 Ultra: aspect_ratio "21:9"|"16:9"|"4:3"|"3:2"|"1:1"|"2:3"|"3:4"|"9:16"|"9:21"
    - Kling: supports seed, reference_image_url, mask_url
    - Gemini 3 Pro Image Preview: text-to-image; reference_image_url 있으면 edit 엔드포인트(image_urls) 사용
    """
    num_images = max(1, min(4, num_images))

    if 'nano-banana-2/edit' in model.lower():
        endpoint = FAL_NANO_BANANA_2_EDIT
        ref_url = kwargs.get('reference_image_url')
        image_urls = kwargs.get('image_urls') or ([ref_url] if ref_url else [])
        if not image_urls:
            raise FALError('image_urls required for nano-banana-2/edit')
        # ngrok/비공개 URL은 백엔드에서 받아 Data URI로 변환해 fal에 전달
        image_urls = [_ensure_fal_reachable_image_url(u) for u in image_urls if u][:14]
        allowed_ratio = ('auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16')
        res = kwargs.get('resolution') or '1K'
        res = res if res in ('0.5K', '1K', '2K', '4K') else '1K'
        out_fmt = kwargs.get('output_format') or 'png'
        out_fmt = out_fmt if out_fmt in ('png', 'jpeg', 'webp') else 'png'
        payload = {
            'prompt': prompt,
            'num_images': num_images,
            'image_urls': image_urls,
            'aspect_ratio': aspect_ratio if aspect_ratio in allowed_ratio else 'auto',
            'output_format': out_fmt,
            'resolution': res,
        }
        if kwargs.get('seed') is not None:
            payload['seed'] = kwargs['seed']
    elif 'nano-banana-2' in model.lower():
        ref_url = kwargs.get('reference_image_url')
        edit_urls = kwargs.get('image_urls') or ([ref_url] if ref_url else [])
        edit_urls = [_ensure_fal_reachable_image_url(u) for u in edit_urls if u][:14]
        allowed_ratio = ('auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16')
        res = kwargs.get('resolution') or '1K'
        res = res if res in ('0.5K', '1K', '2K', '4K') else '1K'
        out_fmt = kwargs.get('output_format') or 'png'
        out_fmt = out_fmt if out_fmt in ('png', 'jpeg', 'webp') else 'png'
        if edit_urls:
            endpoint = FAL_NANO_BANANA_2_EDIT
            payload = {
                'prompt': prompt,
                'num_images': num_images,
                'image_urls': edit_urls,
                'aspect_ratio': aspect_ratio if aspect_ratio in allowed_ratio else 'auto',
                'output_format': out_fmt,
                'resolution': res,
            }
        else:
            endpoint = FAL_NANO_BANANA_2
            payload = {
                'prompt': prompt,
                'num_images': num_images,
                'aspect_ratio': aspect_ratio if aspect_ratio in allowed_ratio else 'auto',
                'output_format': out_fmt,
                'resolution': res,
            }
        if kwargs.get('seed') is not None:
            payload['seed'] = kwargs['seed']
    elif 'gemini-3-pro-image-preview' in model.lower():
        ref_url = kwargs.get('reference_image_url')
        edit_urls = kwargs.get('image_urls') or ([ref_url] if ref_url else [])
        edit_urls = [_ensure_fal_reachable_image_url(u) for u in edit_urls if u][:2]
        allowed_ratio = ('21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16')
        res = kwargs.get('resolution') or '1K'
        res = res if res in ('1K', '2K', '4K') else '1K'
        out_fmt = kwargs.get('output_format') or 'png'
        out_fmt = out_fmt if out_fmt in ('png', 'jpeg', 'webp') else 'png'
        if edit_urls:
            # 참조 이미지 1~2개 → edit API (이미지 기반 편집)
            endpoint = FAL_GEMINI3_PRO_IMAGE_EDIT
            payload = {
                'prompt': prompt,
                'num_images': num_images,
                'image_urls': edit_urls,
                'aspect_ratio': aspect_ratio if aspect_ratio in allowed_ratio else 'auto',
                'output_format': out_fmt,
                'resolution': res,
            }
            if kwargs.get('seed') is not None:
                payload['seed'] = kwargs['seed']
        else:
            # 참조 없음 → text-to-image
            endpoint = FAL_GEMINI3_PRO_IMAGE
            payload = {
                'prompt': prompt,
                'num_images': num_images,
                'aspect_ratio': aspect_ratio if aspect_ratio in allowed_ratio else '1:1',
                'output_format': out_fmt,
                'resolution': res,
            }
            if kwargs.get('seed') is not None:
                payload['seed'] = kwargs['seed']
    elif 'imagen' in model.lower():
        # Imagen4 Preview
        endpoint = FAL_IMAGEN4
        allowed_ratio = ('1:1', '16:9', '9:16', '4:3', '3:4')
        res = kwargs.get('resolution') or '1K'
        res = res if res in ('1K', '2K') else '1K'
        out_fmt = kwargs.get('output_format') or 'png'
        out_fmt = out_fmt if out_fmt in ('png', 'jpeg', 'webp') else 'png'
        payload = {
            'prompt': prompt,
            'num_images': num_images,
            'aspect_ratio': aspect_ratio if aspect_ratio in allowed_ratio else '1:1',
            'resolution': res,
            'output_format': out_fmt,
        }
    elif 'kling' in model.lower():
        # Kling (Visual Continuity)
        endpoint = FAL_KLING
        payload = {
            'prompt': prompt,
            'num_images': num_images,
            'aspect_ratio': aspect_ratio,
        }
        # Add visual continuity params
        if kwargs.get('seed'):
            payload['seed'] = kwargs['seed']
        if kwargs.get('reference_image_url'):
            payload['image_url'] = _ensure_fal_reachable_image_url(kwargs['reference_image_url'])
        if kwargs.get('mask_url'):
            payload['mask_url'] = kwargs['mask_url']

    elif 'flux' in model.lower() or 'sdxl' in model.lower() or 'nano-banana' in model.lower():
        # flux/dev, fast-sdxl, nano-banana: use model as endpoint with common payload
        endpoint = model
        allowed_ratio = ('21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21')
        if aspect_ratio not in allowed_ratio:
            aspect_ratio = '16:9'
        payload = {
            'prompt': prompt,
            'num_images': num_images,
            'aspect_ratio': aspect_ratio,
        }
        if kwargs.get('seed') is not None:
            payload['seed'] = kwargs['seed']

    else:
        # FLUX Pro v1.1 Ultra (default)
        endpoint = FAL_FLUX_ULTRA
        allowed_ratio = ('21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21')
        out_fmt = kwargs.get('output_format') or 'jpeg'
        out_fmt = out_fmt if out_fmt in ('jpeg', 'png') else 'jpeg'
        payload = {
            'prompt': prompt,
            'num_images': num_images,
            'aspect_ratio': aspect_ratio if aspect_ratio in allowed_ratio else '16:9',
            'output_format': out_fmt,
        }

    if _fal_debug_enabled():
        logger.info("fal request: endpoint=%s payload=%s", endpoint, _sanitize_payload(payload))
    r = requests.post(f'{FAL_BASE}/{endpoint}', headers=_fal_headers(), json=payload, timeout=180)
    if not r.ok:
        try:
            err = r.json()
        except Exception:
            err = r.text
        if _fal_debug_enabled():
            logger.error("fal error: endpoint=%s status=%s body=%s", endpoint, r.status_code, err)
        raise FALError(f'fal error {r.status_code}: {err}')
    data = r.json()
    images = data.get('images') or []

    # Return list of dict with url, content_type, etc.
    # Also return 'seed' if provided by API, but fal generic response usually just has url.
    # If Kling returns seed, we should capture it.
    # For now, we return what we get.

    result = []
    for img in images:
        if img.get('url'):
            res = {
                'url': img.get('url'),
                'content_type': img.get('content_type'),
                'file_name': img.get('file_name')
            }
            if 'seed' in img:
                res['seed'] = img['seed']
            elif 'seed' in data: # sometimes seed is top level
                res['seed'] = data['seed']
            result.append(res)

    return result


def remove_background_fal(image_url: str, crop_to_bbox: bool = False) -> dict:
    """
    fal.ai 배경 제거 (rembg).
    input: image_url
    output: {"url": "...", ...}
    """
    if not image_url or not isinstance(image_url, str):
        raise FALError('image_url is required')
    safe_url = _ensure_fal_reachable_image_url(image_url)
    payload = {
        'image_url': safe_url,
        'crop_to_bbox': bool(crop_to_bbox),
    }
    if _fal_debug_enabled():
        logger.info("fal request: endpoint=%s payload=%s", FAL_IMAGEUTILS_REMBG, _sanitize_payload(payload))
    r = requests.post(f'{FAL_BASE}/{FAL_IMAGEUTILS_REMBG}', headers=_fal_headers(), json=payload, timeout=180)
    if not r.ok:
        msg = _extract_error_message(r)
        if _fal_debug_enabled():
            logger.error("fal error: endpoint=%s status=%s body=%s", FAL_IMAGEUTILS_REMBG, r.status_code, msg)
        raise FALError(f'fal error {r.status_code}: {msg}')
    data = r.json() if r.content else {}
    image = data.get('image') if isinstance(data, dict) else None
    if isinstance(image, dict) and image.get('url'):
        return image
    # Some fal endpoints return {"url": ...} directly
    if isinstance(data, dict) and data.get('url'):
        return data
    raise FALError('rembg response missing image url')


# MiniMax Speech 2.6 HD: Studio Step 5 TTS
FAL_TTS_MINIMAX = 'fal-ai/minimax/speech-2.6-hd'

# TTS 시 자연스러운 한국어 읽기: 숫자 → 관형형 (한, 두, 세, 열, 스무...)
_ONES = ('', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉')
_TENS = ('', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔')


def _build_native_1_99() -> dict[int, str]:
    d: dict[int, str] = {}
    for t in range(10):
        for o in range(10):
            n = t * 10 + o
            if n == 0:
                continue
            if t == 0:
                d[n] = _ONES[o]
            elif t == 2 and o == 0:
                d[20] = '스무'  # 스무 시, 스무 살, 스무 개
            else:
                tens = '열' if t == 1 else _TENS[t]
                d[n] = tens + (_ONES[o] if o > 0 else '')
    return d


_NATIVE_1_99 = _build_native_1_99()


def _normalize_korean_for_tts(text: str) -> str:
    """
    TTS가 한국어 숫자를 자연스럽게 읽도록 전처리.
    - 10시 → 열 시, 3시 30분 → 세 시 삼십 분
    - 10개 → 열 개, 5명 → 다섯 명, 3번 → 세 번, 20살 → 스무 살
    """
    if not text or not isinstance(text, str):
        return text
    result = text

    def _repl_native(unit: str):
        def _repl(m):
            try:
                n = int(m.group(1))
                if 1 <= n <= 99 and n in _NATIVE_1_99:
                    return f'{_NATIVE_1_99[n]} {unit}'
            except (ValueError, KeyError):
                pass
            return m.group(0)
        return _repl

    # N시 (1~24만 시는 24시까지)
    def _repl_hour(m):
        try:
            h = int(m.group(1))
            if 1 <= h <= 24:
                s = _NATIVE_1_99.get(h, str(h))
                return f'{s} 시'
        except (ValueError, KeyError):
            pass
        return m.group(0)

    result = re.sub(r'(\d{1,2})\s*시', _repl_hour, result)

    # N개, N명, N번, N번째, N살, N달, N마리, N장, N통, N곡, N편
    for unit in ('개', '명', '번', '살', '달', '마리', '장', '통', '곡', '편'):
        result = re.sub(rf'(\d{{1,2}})\s*{re.escape(unit)}', _repl_native(unit), result)
    result = re.sub(r'(\d{1,2})\s*번째', _repl_native('번째'), result)

    return result


def tts_minimax(
    text: str,
    voice_id: str = 'Wise_Woman',
    speed: float = 1.0,
    output_format: str = 'url',
) -> dict:
    """
    fal.ai MiniMax Speech 2.6 HD TTS.
    Returns dict with 'url' (audio URL) and 'duration_ms'.
    voice_id: preset e.g. Wise_Woman, or custom_voice_id from voice-clone.
    """
    raw = (text or '').strip()
    normalized = _normalize_korean_for_tts(raw)
    payload = {
        'prompt': normalized,
        'output_format': output_format if output_format in ('url', 'hex') else 'url',
        'voice_setting': {
            'voice_id': voice_id,
            'speed': max(0.5, min(2.0, speed)),
            'vol': 1,
            'pitch': 0,
        },
    }
    r = requests.post(f'{FAL_BASE}/{FAL_TTS_MINIMAX}', headers=_fal_headers(), json=payload, timeout=120)
    r.raise_for_status()
    data = r.json()
    audio = data.get('audio') or {}
    url = audio.get('url') or ''
    if not url:
        raise FALError(data.get('error', 'No audio URL'))
    return {'url': url, 'duration_ms': data.get('duration_ms', 0)}


# fal FFmpeg Compose: 이미지+오디오 클립을 하나의 영상으로 합성
FAL_FFMPEG_COMPOSE = 'fal-ai/ffmpeg-api/compose'


def ffmpeg_compose_video(
    clips: list[dict],
    aspect_ratio: str = '9:16',
) -> dict:
    """
    clips: list of { 'image_url': str, 'audio_url': str, 'duration_sec': float }
    Returns: { 'video_url': str, 'thumbnail_url': str }
    """
    if not clips:
        raise FALError('clips required')
    timestamp_ms = 0.0
    video_keyframes = []
    audio_keyframes = []
    for c in clips:
        raw_dur = c.get('duration_sec', 5)
        try:
            dur_sec = float(raw_dur) if raw_dur is not None else 5.0
        except (TypeError, ValueError):
            dur_sec = 5.0
        dur_ms = max(100.0, min(600000.0, dur_sec * 1000))  # 0.1초~600초
        img_url = (c.get('image_url') or '').strip()
        aud_url = (c.get('audio_url') or '').strip()
        if not img_url or not aud_url:
            raise FALError('Each clip must have image_url and audio_url')
        # fal compose는 이미지 URL의 duration을 무시하고 1프레임으로 처리함. 이미지→비디오 변환 후 video URL 전달.
        video_url = _image_to_video_segment(img_url, dur_sec)
        video_keyframes.append({
            'timestamp': timestamp_ms,
            'duration': dur_ms,
            'url': video_url,
        })
        audio_keyframes.append({
            'timestamp': timestamp_ms,
            'duration': dur_ms,
            'url': aud_url,
        })
        timestamp_ms += dur_ms
    # fal expects keyframes in timestamp order; use integers (ms)
    video_keyframes.sort(key=lambda k: k['timestamp'])
    audio_keyframes.sort(key=lambda k: k['timestamp'])
    # fal-ai/ffmpeg-api/compose expects body.tracks at top level (not body.input.tracks)
    body = {
        'tracks': [
            {'id': 'video', 'type': 'video', 'keyframes': video_keyframes},
            {'id': 'audio', 'type': 'audio', 'keyframes': audio_keyframes},
        ],
    }
    try:
        r = requests.post(
            f'{FAL_BASE}/{FAL_FFMPEG_COMPOSE}',
            headers=_fal_headers(),
            json=body,
            timeout=300,
        )
    except requests.RequestException as e:
        raise FALError(f'fal compose request failed: {e}') from e

    if r.status_code == 422:
        try:
            err_body = r.json()
            if isinstance(err_body, dict):
                detail = err_body.get('detail') or err_body.get('message') or err_body.get('error')
                if detail is not None:
                    err = detail if isinstance(detail, str) else str(detail)[:400]
                else:
                    err = str(err_body)[:400]
            else:
                err = str(err_body)[:400]
        except Exception:
            err = (r.text[:400] if r.text else 'unknown')
        raise FALError(f'fal compose 422: {err}')

    try:
        r.raise_for_status()
    except requests.HTTPError as e:
        raise FALError(f'fal compose error {r.status_code}: {e.response.text[:300] if e.response and e.response.text else str(e)}') from e

    try:
        data = r.json()
    except Exception as e:
        raise FALError(f'Invalid response from fal: {e}')
    if not isinstance(data, dict):
        raise FALError('Unexpected response format from fal')
    out = data.get('data') or data
    video_url = (out.get('video_url') or '').strip() if isinstance(out, dict) else ''
    thumbnail_url = (out.get('thumbnail_url') or '').strip() if isinstance(out, dict) else ''
    if not video_url:
        raise FALError(out.get('error', 'No video_url in response') if isinstance(out, dict) else 'No video_url in response')
    return {'video_url': video_url, 'thumbnail_url': thumbnail_url}
