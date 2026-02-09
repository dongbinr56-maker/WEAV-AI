import { api } from './apiClient';
import type { Session } from '@/types';

export const sessionApi = {
  list: (kind?: 'chat' | 'image' | 'studio') =>
    api.get<Session[]>(kind ? `/api/v1/sessions/?kind=${kind}` : '/api/v1/sessions/'),
  create: (kind: 'chat' | 'image' | 'studio', title?: string) =>
    api.post<Session>('/api/v1/sessions/', { kind, title }),
  get: (id: number) => api.get<Session>(`/api/v1/sessions/${id}/`),
  patch: (id: number, data: { title?: string }) =>
    api.patch<Session>(`/api/v1/sessions/${id}/`, data),
  delete: (id: number) => api.delete(`/api/v1/sessions/${id}/`),
};
