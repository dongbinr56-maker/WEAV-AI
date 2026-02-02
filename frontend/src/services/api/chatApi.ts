const BASE = import.meta.env.VITE_API_BASE_URL || '';

import { api } from './apiClient';
import type { JobStatus } from '@/types';

export const chatApi = {
  uploadReferenceImage: (file: File) => {
    const form = new FormData();
    form.append('image', file);
    const url = `${BASE}/api/v1/chat/image/upload-reference/`;
    return fetch(url, { method: 'POST', body: form }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error((err as { detail?: string }).detail || res.statusText);
      }
      return res.json() as Promise<{ url: string }>;
    });
  },
  completeChat: (
    sessionId: number,
    prompt: string,
    model: string,
    options?: { systemPrompt?: string }
  ) =>
    api.post<{ task_id: string; job_id: number; message_id: number }>(
      '/api/v1/chat/complete/',
      {
        session_id: sessionId,
        prompt,
        model,
        system_prompt: options?.systemPrompt,
      }
    ),
  completeImage: (
    sessionId: number,
    prompt: string,
    model: string,
    options?: {
      aspectRatio?: string;
      numImages?: number;
      referenceImageId?: number;
      referenceImageUrl?: string;
      resolution?: string;
      outputFormat?: string;
      seed?: number;
    }
  ) =>
    api.post<{ task_id: string; job_id: number }>('/api/v1/chat/image/', {
      session_id: sessionId,
      prompt,
      model,
      aspect_ratio: options?.aspectRatio ?? '1:1',
      num_images: options?.numImages ?? 1,
      ...(options?.referenceImageId != null && { reference_image_id: options.referenceImageId }),
      ...(options?.referenceImageUrl != null && options.referenceImageUrl !== '' && { reference_image_url: options.referenceImageUrl }),
      ...(options?.resolution != null && options.resolution !== '' && { resolution: options.resolution }),
      ...(options?.outputFormat != null && options.outputFormat !== '' && { output_format: options.outputFormat }),
      ...(options?.seed != null && { seed: options.seed }),
    }),
  regenerateChat: (sessionId: number, model?: string, prompt?: string) =>
    api.post<{ task_id: string; job_id: number; message_id: number }>('/api/v1/chat/regenerate/', {
      session_id: sessionId,
      ...(model != null && { model }),
      ...(prompt != null && prompt !== '' && { prompt }),
    }),
  regenerateImage: (
    sessionId: number,
    options?: { aspectRatio?: string; resolution?: string; outputFormat?: string; seed?: number }
  ) =>
    api.post<{ task_id: string; job_id: number }>('/api/v1/chat/image/regenerate/', {
      session_id: sessionId,
      ...(options?.aspectRatio != null && { aspect_ratio: options.aspectRatio }),
      ...(options?.resolution != null && options.resolution !== '' && { resolution: options.resolution }),
      ...(options?.outputFormat != null && options.outputFormat !== '' && { output_format: options.outputFormat }),
      ...(options?.seed != null && { seed: options.seed }),
    }),
  jobStatus: (taskId: string) => api.get<JobStatus>(`/api/v1/chat/job/${taskId}/`),
  cancelJob: (taskId: string) => api.post(`/api/v1/chat/job/${taskId}/cancel/`, {}),
};
