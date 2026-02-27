import { api } from '../api/apiClient';

const STUDIO_LLM = '/api/v1/studio/llm/';
const STUDIO_IMAGE = '/api/v1/studio/image/';
const STUDIO_TTS = '/api/v1/studio/tts/';
const STUDIO_YOUTUBE_CONTEXT = '/api/v1/studio/youtube-context/';
const STUDIO_YOUTUBE_BENCHMARK_ANALYZE = '/api/v1/studio/youtube-benchmark-analyze/';

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

export interface StudioYouTubeContext {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  thumbnail: string;
  description: string;
  transcript: string;
  hasTranscript: boolean;
  durationSeconds?: number | null;
  source?: {
    oembed?: boolean;
    description?: boolean;
    transcript?: boolean;
    duration?: boolean;
  };
}

export interface StudioYouTubeBenchmarkAnalysis {
  summary: string;
  patterns: string[];
  meta?: {
    provider?: string;
    analysisMode?: string;
    directVideoAttempted?: boolean;
    directVideoError?: string;
    model?: string;
    hasTranscript?: boolean;
    durationSeconds?: number | null;
    maxDurationSeconds?: number;
    videoId?: string;
    title?: string;
    channel?: string;
    source?: {
      oembed?: boolean;
      description?: boolean;
      transcript?: boolean;
      duration?: boolean;
    };
  };
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

/** YouTube URL context (metadata/transcript/description) for benchmarking analysis. */
export async function studioYouTubeContext(url: string): Promise<StudioYouTubeContext> {
  const path = `${STUDIO_YOUTUBE_CONTEXT}?url=${encodeURIComponent(url)}`;
  return api.get<StudioYouTubeContext>(path);
}

/** YouTube benchmarking analysis via backend Google AI Studio Gemini. */
export async function studioYouTubeBenchmarkAnalyze(url: string): Promise<StudioYouTubeBenchmarkAnalysis> {
  return api.post<StudioYouTubeBenchmarkAnalysis>(STUDIO_YOUTUBE_BENCHMARK_ANALYZE, { url });
}
