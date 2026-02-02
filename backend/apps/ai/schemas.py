from typing import Optional

from pydantic import BaseModel, Field


class TextGenerationRequest(BaseModel):
    prompt: str
    model: str = Field(default='google/gemini-2.5-flash')
    system_prompt: Optional[str] = None
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: Optional[int] = None


class ImageGenerationRequest(BaseModel):
    prompt: str
    model: str = Field(default='fal-ai/imagen4/preview')
    aspect_ratio: str = Field(default='1:1')
    num_images: int = Field(default=1, ge=1, le=4)
