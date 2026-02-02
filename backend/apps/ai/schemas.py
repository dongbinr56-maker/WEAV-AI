from typing import Optional

from pydantic import BaseModel, Field

# 채팅 프롬프트: 1자 이상, 32만자 이하 (모델 컨텍스트 한도 내)
CHAT_PROMPT_MIN_LEN = 1
CHAT_PROMPT_MAX_LEN = 320_000

# 이미지 프롬프트: 1자 이상, 1만자 이하 (fal 등 제한 고려)
IMAGE_PROMPT_MIN_LEN = 1
IMAGE_PROMPT_MAX_LEN = 10_000


class TextGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=CHAT_PROMPT_MIN_LEN, max_length=CHAT_PROMPT_MAX_LEN)
    model: str = Field(default='google/gemini-2.5-flash')
    system_prompt: Optional[str] = Field(None, max_length=CHAT_PROMPT_MAX_LEN)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: Optional[int] = Field(None, ge=1, le=128_000)


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=IMAGE_PROMPT_MIN_LEN, max_length=IMAGE_PROMPT_MAX_LEN)
    model: str = Field(default='fal-ai/imagen4/preview')
    aspect_ratio: str = Field(default='1:1')
    num_images: int = Field(default=1, ge=1, le=4)
    reference_image_id: Optional[int] = None
    reference_image_url: Optional[str] = Field(None, max_length=2048)
    resolution: Optional[str] = Field(None, pattern=r'^(1K|2K|4K)$')
    output_format: Optional[str] = Field(None, pattern=r'^(png|jpeg|webp)$')
    seed: Optional[int] = Field(None, ge=0)
