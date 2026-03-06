from datetime import date
from typing import Optional

from .fal_client import (
    chat_completion,
    image_generation_fal,
    FAL_IMAGEN4,
    FAL_FLUX_ULTRA,
    FAL_KLING,
    FAL_GEMINI3_PRO_IMAGE,
    FAL_NANO_BANANA_PRO,
    FAL_NANO_BANANA_PRO_EDIT,
)
from .errors import AIError

# OpenRouter 모델 ID (fal.ai openrouter/router). 존재하지 않는 ID는 400 유발
CHAT_MODELS = [
    'google/gemini-2.5-flash',
    'openai/gpt-4.1',
    'anthropic/claude-sonnet-4.6',
    'anthropic/claude-opus-4.6',
    'anthropic/claude-sonnet-4.5',
    'meta-llama/llama-4-maverick',
    'openai/gpt-oss-120b',
]

CHAT_MODEL_ALIASES = {
    # legacy / UI ids
    'openai/gpt-5-chat': 'openai/gpt-4.1',
    'openai/gpt-4o': 'openai/gpt-4.1',
    'openai/gpt-4o-mini': 'openai/gpt-4.1',
    'google/gemini-2.5-pro': 'google/gemini-2.5-flash',
    # Gemini bare ids used by older Studio benchmarking code
    'gemini-2.5-flash': 'google/gemini-2.5-flash',
    'gemini-2.5-pro': 'google/gemini-2.5-flash',
}

# 채팅 모델별 지식 컷오프(YYYY-MM). 검색 필요성 판별·규칙 기반 필터에 사용.
# None = 공식 문서에 미기재(보수적으로 검색 권장 시 유리).
MODEL_KNOWLEDGE_CUTOFF: dict[str, date | None] = {
    "google/gemini-2.5-flash": date(2025, 1, 1),   # Gemini 2.5 Flash model card
    "openai/gpt-4.1": date(2024, 6, 1),             # OpenAI official
    "anthropic/claude-sonnet-4.6": date(2025, 5, 1),
    "anthropic/claude-opus-4.6": date(2025, 5, 1),
    "anthropic/claude-sonnet-4.5": date(2025, 7, 1), # Vertex AI docs
    "meta-llama/llama-4-maverick": date(2024, 8, 1),
    "openai/gpt-oss-120b": None,                     # not specified in model card
}

def normalize_chat_model(model: Optional[str]) -> str:
    m = (model or '').strip() or 'google/gemini-2.5-flash'
    m = CHAT_MODEL_ALIASES.get(m, m)
    # If someone passes bare gemini id, map to google/*
    if '/' not in m and m.startswith('gemini-'):
        m = f'google/{m}'
    return m if m in CHAT_MODELS else 'google/gemini-2.5-flash'

IMAGE_MODEL_GOOGLE = FAL_IMAGEN4
IMAGE_MODEL_FLUX = FAL_FLUX_ULTRA
IMAGE_MODEL_KLING = FAL_KLING
IMAGE_MODEL_GEMINI3_PRO_IMAGE = FAL_GEMINI3_PRO_IMAGE
IMAGE_MODEL_NANO_BANANA = FAL_NANO_BANANA_PRO
IMAGE_MODEL_NANO_BANANA_EDIT = FAL_NANO_BANANA_PRO_EDIT


def run_chat(prompt: str, model: str = 'google/gemini-2.5-flash', system_prompt: Optional[str] = None, temperature: float = 0.7, max_tokens: Optional[int] = None) -> str:
    return chat_completion(prompt, model=model, system_prompt=system_prompt, temperature=temperature, max_tokens=max_tokens)


def run_image(prompt: str, model: str = IMAGE_MODEL_GOOGLE, aspect_ratio: str = '1:1', num_images: int = 1, **kwargs) -> list[dict]:
    """
    Generate images using the specified model.
    kwargs can include: seed, reference_image_url, mask_url
    """
    return image_generation_fal(prompt, model=model, aspect_ratio=aspect_ratio, num_images=num_images, **kwargs)
