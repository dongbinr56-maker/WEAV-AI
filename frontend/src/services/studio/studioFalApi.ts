import { api } from '../api/apiClient';

const STUDIO_LLM = '/api/v1/studio/llm/';
const STUDIO_IMAGE = '/api/v1/studio/image/';
const STUDIO_TTS = '/api/v1/studio/tts/';
const STUDIO_VIDEO = '/api/v1/studio/video/';

export interface StudioLlmOptions {
  prompt: string;
  system_prompt?: string;
  model?: string;
}

export interface StudioImageOptions {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  num_images?: number;
  seed?: number;
  reference_image_url?: string;
}

export interface StudioTtsOptions {
  text: string;
  voice_id?: string;
  speed?: number;
}

/** Studio Step 2~4 LLM (fal openrouter). */
export async function studioLlm(options: StudioLlmOptions): Promise<{ output: string }> {
  const { prompt, system_prompt, model } = options;
  return api.post<{ output: string }>(STUDIO_LLM, {
    prompt,
    ...(system_prompt != null && { system_prompt }),
    ...(model != null && { model }),
  });
}

/** Studio scene image (fal imagen/flux/etc). */
export async function studioImage(options: StudioImageOptions): Promise<{ images: Array<{ url: string }> }> {
  const { prompt, model, aspect_ratio, num_images, seed, reference_image_url } = options;
  return api.post<{ images: Array<{ url: string }> }>(STUDIO_IMAGE, {
    prompt,
    ...(model != null && { model }),
    ...(aspect_ratio != null && { aspect_ratio }),
    ...(num_images != null && { num_images }),
    ...(seed != null && { seed }),
    ...(reference_image_url != null && { reference_image_url }),
  });
}

/** Studio Step 5 TTS (MiniMax). */
export async function studioTts(options: StudioTtsOptions): Promise<{ url: string; duration_ms: number }> {
  const { text, voice_id, speed } = options;
  return api.post<{ url: string; duration_ms: number }>(STUDIO_TTS, {
    text,
    ...(voice_id != null && { voice_id }),
    ...(speed != null && { speed }),
  });
}

export interface StudioVideoClip {
  image_url: string;
  audio_url: string;
  duration_sec: number;
}

export interface StudioExportVideoOptions {
  clips: StudioVideoClip[];
  aspect_ratio?: string;
}

/** Studio Step 6: 이미지+음성 클립을 합쳐 영상으로 내보내기 (fal ffmpeg compose). */
export async function studioExportVideo(options: StudioExportVideoOptions): Promise<{ video_url?: string; thumbnail_url?: string }> {
  const { clips, aspect_ratio } = options;
  return api.post<{ video_url?: string; thumbnail_url?: string }>(
    STUDIO_VIDEO,
    { clips, ...(aspect_ratio != null && { aspect_ratio }) },
    { timeoutMs: 600_000 }
  );
}
