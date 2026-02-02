import { api } from './apiClient';
import type { JobStatus } from '@/types';

export const chatApi = {
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
    options?: { aspectRatio?: string }
  ) =>
    api.post<{ task_id: string; job_id: number }>('/api/v1/chat/image/', {
      session_id: sessionId,
      prompt,
      model,
      aspect_ratio: options?.aspectRatio || '1:1',
    }),
  regenerateChat: (sessionId: number, model?: string, prompt?: string) =>
    api.post<{ task_id: string; job_id: number; message_id: number }>('/api/v1/chat/regenerate/', {
      session_id: sessionId,
      ...(model != null && { model }),
      ...(prompt != null && prompt !== '' && { prompt }),
    }),
  regenerateImage: (sessionId: number, aspectRatio?: string) =>
    api.post<{ task_id: string; job_id: number }>('/api/v1/chat/image/regenerate/', {
      session_id: sessionId,
      ...(aspectRatio != null && { aspect_ratio: aspectRatio }),
    }),
  jobStatus: (taskId: string) => api.get<JobStatus>(`/api/v1/chat/job/${taskId}/`),
  cancelJob: (taskId: string) => api.post(`/api/v1/chat/job/${taskId}/cancel/`, {}),
};
