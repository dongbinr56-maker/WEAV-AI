const BASE = import.meta.env.VITE_API_BASE_URL || '';

import { api } from './apiClient';
import type { JobStatus, DocumentItem } from '@/types';

export const chatApi = {
  listDocuments: (sessionId: number) =>
    api.get<DocumentItem[]>(`/api/v1/sessions/${sessionId}/documents/`),
  deleteDocument: (sessionId: number, documentId: number) =>
    api.delete(`/api/v1/sessions/${sessionId}/documents/${documentId}/`),
  uploadDocument: (sessionId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const url = `${BASE}/api/v1/sessions/${sessionId}/upload/`;
    return fetch(url, { method: 'POST', body: form }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error((err as { detail?: string }).detail || res.statusText);
      }
      return res.json() as Promise<{ document_id: number; original_name: string; status: string; file_url: string }>;
    });
  },
  uploadImageAttachments: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('images', f));
    const url = `${BASE}/api/v1/chat/image/upload-attachments/`;
    return fetch(url, { method: 'POST', body: form }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error((err as { detail?: string }).detail || res.statusText);
      }
      return res.json() as Promise<{ urls: string[] }>;
    });
  },
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
      referenceImageUrls?: string[];
      imageUrls?: string[];
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
      ...(options?.referenceImageUrls != null && options.referenceImageUrls.length > 0 && { reference_image_urls: options.referenceImageUrls }),
      ...(options?.imageUrls != null && options.imageUrls.length > 0 && { image_urls: options.imageUrls }),
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
    options?: {
      prompt?: string;
      model?: string;
      aspectRatio?: string;
      referenceImageId?: number;
      referenceImageUrl?: string;
      referenceImageUrls?: string[];
      imageUrls?: string[];
      resolution?: string;
      outputFormat?: string;
      seed?: number;
    }
  ) =>
    api.post<{ task_id: string; job_id: number }>('/api/v1/chat/image/regenerate/', {
      session_id: sessionId,
      ...(options?.prompt != null && options.prompt !== '' && { prompt: options.prompt }),
      ...(options?.model != null && options.model !== '' && { model: options.model }),
      ...(options?.aspectRatio != null && { aspect_ratio: options.aspectRatio }),
      ...(options?.referenceImageId != null && { reference_image_id: options.referenceImageId }),
      ...(options?.referenceImageUrl != null && options.referenceImageUrl !== '' && { reference_image_url: options.referenceImageUrl }),
      ...(options?.referenceImageUrls != null && options.referenceImageUrls.length > 0 && { reference_image_urls: options.referenceImageUrls }),
      ...(options?.imageUrls != null && options.imageUrls.length > 0 && { image_urls: options.imageUrls }),
      ...(options?.resolution != null && options.resolution !== '' && { resolution: options.resolution }),
      ...(options?.outputFormat != null && options.outputFormat !== '' && { output_format: options.outputFormat }),
      ...(options?.seed != null && { seed: options.seed }),
    }),
  generateVideoPrompt: (options: {
    inputConcept: string;
    style?: string;
    cameraStyle?: string;
    cameraDirection?: string;
    pacing?: string;
    specialEffects?: string;
    customElements?: string;
    promptLength?: 'short' | 'medium' | 'long';
    model?: string;
  }) =>
    api.post<{ prompt: string; model?: string }>('/api/v1/studio/video-prompt/', {
      input_concept: options.inputConcept,
      ...(options.style != null && options.style !== '' && { style: options.style }),
      ...(options.cameraStyle != null && options.cameraStyle !== '' && { camera_style: options.cameraStyle }),
      ...(options.cameraDirection != null && options.cameraDirection !== '' && { camera_direction: options.cameraDirection }),
      ...(options.pacing != null && options.pacing !== '' && { pacing: options.pacing }),
      ...(options.specialEffects != null && options.specialEffects !== '' && { special_effects: options.specialEffects }),
      ...(options.customElements != null && options.customElements !== '' && { custom_elements: options.customElements }),
      ...(options.promptLength != null && { prompt_length: options.promptLength }),
      ...(options.model != null && options.model !== '' && { model: options.model }),
    }),
  jobStatus: (taskId: string) => api.get<JobStatus>(`/api/v1/chat/job/${taskId}/`),
  cancelJob: (taskId: string) => api.post(`/api/v1/chat/job/${taskId}/cancel/`, {}),
};
