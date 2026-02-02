from typing import Optional

from .fal_client import chat_completion, image_generation_fal, FAL_IMAGEN4, FAL_FLUX_ULTRA, FAL_KLING, FAL_GEMINI3_PRO_IMAGE
from .errors import AIError

CHAT_MODELS = [
    'google/gemini-2.5-flash',
    'google/gemini-2.5-pro',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'openai/gpt-5-chat',
]

IMAGE_MODEL_GOOGLE = FAL_IMAGEN4
IMAGE_MODEL_FLUX = FAL_FLUX_ULTRA
IMAGE_MODEL_KLING = FAL_KLING
IMAGE_MODEL_GEMINI3_PRO_IMAGE = FAL_GEMINI3_PRO_IMAGE


def run_chat(prompt: str, model: str = 'google/gemini-2.5-flash', system_prompt: Optional[str] = None, temperature: float = 0.7, max_tokens: Optional[int] = None) -> str:
    return chat_completion(prompt, model=model, system_prompt=system_prompt, temperature=temperature, max_tokens=max_tokens)


def run_image(prompt: str, model: str = IMAGE_MODEL_GOOGLE, aspect_ratio: str = '1:1', num_images: int = 1, **kwargs) -> list[dict]:
    """
    Generate images using the specified model.
    kwargs can include: seed, reference_image_url, mask_url
    """
    return image_generation_fal(prompt, model=model, aspect_ratio=aspect_ratio, num_images=num_images, **kwargs)
