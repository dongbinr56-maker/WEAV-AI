import type { ChatModel, ImageModel } from '@/types';

export const CHAT_MODELS: ChatModel[] = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'Anthropic' },
  { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', provider: 'Anthropic' },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Anthropic' },
  { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', provider: 'Meta' },
];

export function normalizeChatModelId(modelId: string | null | undefined): string {
  const raw = String(modelId ?? '').trim();
  const aliases: Record<string, string> = {
    'openai/gpt-5-chat': 'openai/gpt-4.1',
    'openai/gpt-4o': 'openai/gpt-4.1',
    'openai/gpt-4o-mini': 'openai/gpt-4.1',
    'google/gemini-2.5-pro': 'google/gemini-2.5-flash',
  };
  const next = aliases[raw] ?? raw;
  const supported = new Set(CHAT_MODELS.map((m) => m.id));
  return supported.has(next) ? next : 'google/gemini-2.5-flash';
}

export const IMAGE_MODEL_ID_IMAGEN4 = 'fal-ai/imagen4/preview';
export const IMAGE_MODEL_ID_FLUX = 'fal-ai/flux-pro/v1.1-ultra';
export const IMAGE_MODEL_ID_GEMINI = 'fal-ai/gemini-3-pro-image-preview';
export const IMAGE_MODEL_ID_KLING = 'kling-ai/kling-v1';
export const IMAGE_MODEL_ID_NANO_BANANA = 'fal-ai/nano-banana-pro';
export const IMAGE_MODEL_ID_NANO_BANANA_2 = 'fal-ai/nano-banana-2';

export const IMAGE_MODELS: ImageModel[] = [
  { id: IMAGE_MODEL_ID_IMAGEN4, name: 'Imagen 4 (Google)', provider: 'Google' },
  { id: IMAGE_MODEL_ID_FLUX, name: 'FLUX Pro v1.1 Ultra', provider: 'fal.ai' },
  { id: IMAGE_MODEL_ID_NANO_BANANA, name: 'Nano Banana Pro', provider: 'Google' },
  { id: IMAGE_MODEL_ID_NANO_BANANA_2, name: 'Nano Banana 2', provider: 'Google' },
];

export function normalizeImageModelId(modelId: string | null | undefined): string {
  const raw = String(modelId ?? '').trim();
  const aliases: Record<string, string> = {
    [IMAGE_MODEL_ID_KLING]: IMAGE_MODEL_ID_NANO_BANANA,
  };
  const next = aliases[raw] ?? raw;
  const supported = new Set(IMAGE_MODELS.map((m) => m.id));
  return supported.has(next) ? next : IMAGE_MODEL_ID_NANO_BANANA;
}

export type ImageModelSettings = {
  aspectRatios: string[];
  resolutions?: string[];
  outputFormats?: string[];
  numImagesMax: number;
  supportsSeed: boolean;
};

export const IMAGE_MODEL_SETTINGS: Record<string, ImageModelSettings> = {
  [IMAGE_MODEL_ID_IMAGEN4]: {
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutions: ['1K', '2K'],
    outputFormats: ['png', 'jpeg', 'webp'],
    numImagesMax: 4,
    supportsSeed: false,
  },
  [IMAGE_MODEL_ID_FLUX]: {
    aspectRatios: ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21'],
    outputFormats: ['jpeg', 'png'],
    numImagesMax: 4,
    supportsSeed: false,
  },
  [IMAGE_MODEL_ID_GEMINI]: {
    aspectRatios: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
    resolutions: ['1K', '2K', '4K'],
    outputFormats: ['png', 'jpeg', 'webp'],
    numImagesMax: 4,
    supportsSeed: true,
  },
  [IMAGE_MODEL_ID_NANO_BANANA]: {
    aspectRatios: ['1:1', '21:9', '16:9', '3:2', '4:3', '5:4', '4:5', '3:4', '2:3', '9:16'],
    resolutions: ['1K', '2K', '4K'],
    outputFormats: ['png', 'jpeg', 'webp'],
    numImagesMax: 4,
    supportsSeed: true,
  },
  [IMAGE_MODEL_ID_NANO_BANANA_2]: {
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21'],
    outputFormats: ['jpeg', 'png'],
    numImagesMax: 4,
    supportsSeed: false,
  },
  [IMAGE_MODEL_ID_KLING]: {
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
  const defaultAspectRatio = s?.aspectRatios?.includes('1:1')
    ? '1:1'
    : (s?.aspectRatios?.[0] ?? '1:1');
  return {
    aspect_ratio: defaultAspectRatio,
    num_images: 1,
    resolution: s?.resolutions?.[0] ?? '1K',
    output_format: s?.outputFormats?.[0] ?? 'png',
  };
}

/** 참조 이미지(업로드·선택)를 지원하는 이미지 모델 ID */
export const IMAGE_MODELS_SUPPORT_REFERENCE = [
  IMAGE_MODEL_ID_NANO_BANANA,
  IMAGE_MODEL_ID_NANO_BANANA_2,
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
  'openai/gpt-4.1': 128_000,
  'anthropic/claude-sonnet-4.6': 320_000,
  'anthropic/claude-opus-4.6': 320_000,
  'anthropic/claude-sonnet-4.5': 320_000,
  'meta-llama/llama-4-maverick': 320_000,
};

/** 모델별 이미지 프롬프트 최대 길이 (없으면 공통값 사용) */
export const IMAGE_PROMPT_MAX_LENGTH_BY_MODEL: Record<string, number> = {
  [IMAGE_MODEL_ID_IMAGEN4]: 10_000,
  [IMAGE_MODEL_ID_FLUX]: 10_000,
  [IMAGE_MODEL_ID_GEMINI]: 10_000,
  [IMAGE_MODEL_ID_NANO_BANANA]: 10_000,
  [IMAGE_MODEL_ID_NANO_BANANA_2]: 10_000,
  [IMAGE_MODEL_ID_KLING]: 10_000,
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
