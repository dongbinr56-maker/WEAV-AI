import { api } from '../api/apiClient';

const STUDIO_LLM = '/api/v1/studio/llm/';
const STUDIO_IMAGE = '/api/v1/studio/image/';
const STUDIO_TTS = '/api/v1/studio/tts/';
const STUDIO_YOUTUBE_CONTEXT = '/api/v1/studio/youtube-context/';
const STUDIO_YOUTUBE_BENCHMARK_ANALYZE = '/api/v1/studio/youtube-benchmark-analyze/';
const STUDIO_EXPORT = '/api/v1/studio/export/';
const STUDIO_EXPORT_JOB = '/api/v1/studio/export/job/';
const STUDIO_UPLOAD_REFERENCE_IMAGE = '/api/v1/chat/image/upload-reference/';
const STUDIO_VIDEO = '/api/v1/studio/video/';
const STUDIO_BG_REMOVE = '/api/v1/studio/bg-remove/';

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
  content?: { summary?: string; keyPoints?: string[] };
  delivery?: { summary?: string; patterns?: string[] };
  meta?: {
    provider?: string;
    analysisMode?: string;
    contentAnalysisMode?: string;
    deliveryAnalysisMode?: string;
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

/** YouTube benchmarking analysis (Gemini direct video + fallback). */
export async function studioYouTubeBenchmarkAnalyze(url: string): Promise<StudioYouTubeBenchmarkAnalysis> {
  return api.post<StudioYouTubeBenchmarkAnalysis>(STUDIO_YOUTUBE_BENCHMARK_ANALYZE, { url });
}

/** Upload a reference image and get a public URL (reuses chat image upload endpoint). */
export async function uploadStudioReferenceImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('image', file);
  return api.postForm<{ url: string }>(STUDIO_UPLOAD_REFERENCE_IMAGE, form);
}

/** Studio Reference Step: background removal (rembg). */
export async function studioBgRemove(imageUrl: string, options?: { crop_to_bbox?: boolean }): Promise<{ image: { url: string } }> {
  return api.post<{ image: { url: string } }>(STUDIO_BG_REMOVE, { image_url: imageUrl, ...(options ?? {}) });
}

export type StudioExportScene = {
  image_url: string;
  audio_url: string;
  text?: string;
  duration_sec?: number;
};

export type StudioExportResponse = { task_id: string; job_id: number };

export async function studioExport(options: {
  session_id: number;
  aspect_ratio: '9:16' | '16:9';
  fps?: number;
  subtitles_enabled?: boolean;
  burn_in_subtitles?: boolean;
  scenes: StudioExportScene[];
}): Promise<StudioExportResponse> {
  return api.post<StudioExportResponse>(STUDIO_EXPORT, options);
}

export type StudioExportJobStatus = {
  task_id: string;
  job_id: number;
  kind: string;
  status: 'pending' | 'running' | 'success' | 'failure';
  result: {
    video_url?: string;
    captions?: { srt_url?: string | null; vtt_url?: string | null; burn_in?: boolean; enabled?: boolean };
    meta?: unknown;
  };
  error?: string;
};

export async function studioExportJobStatus(taskId: string): Promise<StudioExportJobStatus> {
  return api.get<StudioExportJobStatus>(`${STUDIO_EXPORT_JOB}${encodeURIComponent(taskId)}/`);
}

export async function studioExportJobCancel(taskId: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`${STUDIO_EXPORT_JOB}${encodeURIComponent(taskId)}/cancel/`, {});
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
