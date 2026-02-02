import type { ChatModel, ImageModel } from '@/types';

export const CHAT_MODELS: ChatModel[] = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
  { id: 'openai/gpt-5-chat', name: 'GPT-5 Chat', provider: 'OpenAI' },
];

export const IMAGE_MODELS: ImageModel[] = [
  { id: 'fal-ai/imagen4/preview', name: 'Imagen 4 (Google)', provider: 'Google' },
  { id: 'fal-ai/flux-pro/v1.1-ultra', name: 'FLUX Pro v1.1 Ultra', provider: 'fal.ai' },
  { id: 'fal-ai/gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview', provider: 'Google' },
  { id: 'kling-ai/kling-v1', name: 'Kling', provider: 'Kling' },
];

export type ImageModelSettings = {
  aspectRatios: string[];
  resolutions?: string[];
  outputFormats?: string[];
  numImagesMax: number;
  supportsSeed: boolean;
};

export const IMAGE_MODEL_SETTINGS: Record<string, ImageModelSettings> = {
  'fal-ai/imagen4/preview': {
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutions: ['1K', '2K'],
    outputFormats: ['png', 'jpeg', 'webp'],
    numImagesMax: 4,
    supportsSeed: false,
  },
  'fal-ai/flux-pro/v1.1-ultra': {
    aspectRatios: ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21'],
    outputFormats: ['jpeg', 'png'],
    numImagesMax: 4,
    supportsSeed: false,
  },
  'fal-ai/gemini-3-pro-image-preview': {
    aspectRatios: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
    resolutions: ['1K', '2K', '4K'],
    outputFormats: ['png', 'jpeg', 'webp'],
    numImagesMax: 4,
    supportsSeed: true,
  },
  'kling-ai/kling-v1': {
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    numImagesMax: 4,
    supportsSeed: true,
  },
};

export type ImageGenOptions = {
  aspect_ratio: string;
  num_images: number;
  resolution?: string;
  output_format?: string;
  seed?: number;
};

export function getDefaultImageOptions(modelId: string): ImageGenOptions {
  const s = IMAGE_MODEL_SETTINGS[modelId];
  return {
    aspect_ratio: s?.aspectRatios?.[0] ?? '1:1',
    num_images: 1,
    resolution: s?.resolutions?.[0] ?? '1K',
    output_format: s?.outputFormats?.[0] ?? 'png',
  };
}

/** 참조 이미지(업로드·선택)를 지원하는 이미지 모델 ID */
export const IMAGE_MODELS_SUPPORT_REFERENCE = [
  'fal-ai/gemini-3-pro-image-preview',
  'kling-ai/kling-v1',
] as const;

export function imageModelSupportsReference(modelId: string): boolean {
  return IMAGE_MODELS_SUPPORT_REFERENCE.includes(modelId as (typeof IMAGE_MODELS_SUPPORT_REFERENCE)[number]);
}

/** 채팅 프롬프트: 1자 이상, 32만자 이하 */
export const CHAT_PROMPT_MIN_LENGTH = 1;
export const CHAT_PROMPT_MAX_LENGTH = 320_000;

/** 이미지 프롬프트: 1자 이상, 1만자 이하 */
export const IMAGE_PROMPT_MIN_LENGTH = 1;
export const IMAGE_PROMPT_MAX_LENGTH = 10_000;

/** 모델별 채팅 프롬프트 최대 길이 (없으면 공통값 사용) */
export const CHAT_PROMPT_MAX_LENGTH_BY_MODEL: Record<string, number> = {
  'google/gemini-2.5-flash': 1_000_000,
  'google/gemini-2.5-pro': 1_000_000,
  'openai/gpt-4o': 128_000,
  'openai/gpt-4o-mini': 128_000,
  'openai/gpt-5-chat': 128_000,
};

/** 모델별 이미지 프롬프트 최대 길이 (없으면 공통값 사용) */
export const IMAGE_PROMPT_MAX_LENGTH_BY_MODEL: Record<string, number> = {
  'fal-ai/imagen4/preview': 10_000,
  'fal-ai/flux-pro/v1.1-ultra': 10_000,
  'fal-ai/gemini-3-pro-image-preview': 10_000,
  'kling-ai/kling-v1': 10_000,
};

export type PromptValidationResult = { valid: true } | { valid: false; message: string };

export function validateChatPrompt(text: string, modelId: string): PromptValidationResult {
  const trimmed = text.trim();
  if (trimmed.length < CHAT_PROMPT_MIN_LENGTH) {
    return { valid: false, message: '메시지를 입력해 주세요.' };
  }
  const maxLen = CHAT_PROMPT_MAX_LENGTH_BY_MODEL[modelId] ?? CHAT_PROMPT_MAX_LENGTH;
  if (trimmed.length > maxLen) {
    return { valid: false, message: `메시지는 ${(maxLen / 1000).toFixed(0)}천자 이하여야 합니다. (현재 ${trimmed.length.toLocaleString()}자)` };
  }
  return { valid: true };
}

export function validateImagePrompt(text: string, modelId: string): PromptValidationResult {
  const trimmed = text.trim();
  if (trimmed.length < IMAGE_PROMPT_MIN_LENGTH) {
    return { valid: false, message: '이미지 설명을 입력해 주세요.' };
  }
  const maxLen = IMAGE_PROMPT_MAX_LENGTH_BY_MODEL[modelId] ?? IMAGE_PROMPT_MAX_LENGTH;
  if (trimmed.length > maxLen) {
    return { valid: false, message: `설명은 ${(maxLen / 1000).toFixed(0)}천자 이하여야 합니다. (현재 ${trimmed.length.toLocaleString()}자)` };
  }
  return { valid: true };
}
