"""
fal.ai HTTP API: openrouter/router (chat), imagen4 (Google), flux-pro v1.1-ultra (FLUX), Kling.
참고: 00_docs/imagen4-preview.txt, 00_docs/flux-pro_v1.1-ultra.txt
"""
import os
from typing import Optional

import requests
from .errors import FALError

FAL_BASE = 'https://fal.run'
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


def _fal_headers():
    key = os.environ.get('FAL_KEY', '')
    if not key:
        raise FALError('FAL_KEY not set')
    return {'Authorization': f'Key {key}', 'Content-Type': 'application/json'}


def chat_completion(prompt: str, model: str = 'google/gemini-2.5-flash', system_prompt: Optional[str] = None, temperature: float = 0.7, max_tokens: Optional[int] = None) -> str:
    payload = {'prompt': prompt, 'model': model, 'temperature': temperature}
    if system_prompt:
        payload['system_prompt'] = system_prompt
    if max_tokens is not None:
        payload['max_tokens'] = max_tokens
    r = requests.post(f'{FAL_BASE}/{FAL_CHAT_ENDPOINT}', headers=_fal_headers(), json=payload, timeout=120)
    r.raise_for_status()
    data = r.json()
    if 'output' not in data:
        raise FALError(data.get('error', 'No output'))
    return data['output']


def image_generation_fal(prompt: str, model: str = FAL_IMAGEN4, aspect_ratio: str = '1:1', num_images: int = 1, **kwargs) -> list[dict]:
    """
    fal.ai 이미지 생성.
    - Imagen 4: aspect_ratio "1:1"|"16:9"|"9:16"|"4:3"|"3:4", num_images 1~4
    - FLUX Pro v1.1 Ultra: aspect_ratio "21:9"|"16:9"|"4:3"|"3:2"|"1:1"|"2:3"|"3:4"|"9:16"|"9:21"
    - Kling: supports seed, reference_image_url, mask_url
    - Gemini 3 Pro Image Preview: text-to-image; reference_image_url 있으면 edit 엔드포인트(image_urls) 사용
    """
    num_images = max(1, min(4, num_images))

    if 'gemini-3-pro-image-preview' in model.lower():
        ref_url = kwargs.get('reference_image_url')
        allowed_ratio = ('21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16')
        res = kwargs.get('resolution') or '1K'
        res = res if res in ('1K', '2K', '4K') else '1K'
        out_fmt = kwargs.get('output_format') or 'png'
        out_fmt = out_fmt if out_fmt in ('png', 'jpeg', 'webp') else 'png'
        if ref_url:
            # 참조 이미지 있음 → edit API (이미지 기반 편집)
            endpoint = FAL_GEMINI3_PRO_IMAGE_EDIT
            payload = {
                'prompt': prompt,
                'num_images': num_images,
                'image_urls': [ref_url],
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
            payload['image_url'] = kwargs['reference_image_url']
        if kwargs.get('mask_url'):
            payload['mask_url'] = kwargs['mask_url']

    else:
        # FLUX Pro v1.1 Ultra
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

    r = requests.post(f'{FAL_BASE}/{endpoint}', headers=_fal_headers(), json=payload, timeout=180)
    r.raise_for_status()
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
