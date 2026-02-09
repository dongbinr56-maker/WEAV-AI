export type SessionKind = 'chat' | 'image' | 'studio';

export interface Session {
  id: number;
  kind: SessionKind;
  title: string;
  created_at: string;
  updated_at: string;
  messages?: Message[];
  image_records?: ImageRecord[];
}

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ImageRecord {
  id: number;
  prompt: string;
  image_url: string;
  model: string;
  created_at: string;
}

export interface JobStatus {
  task_id: string;
  job_id: number;
  status: 'pending' | 'running' | 'success' | 'failure';
  message?: Message;
  image?: ImageRecord;
  error?: string;
}

export interface ChatModel {
  id: string;
  name: string;
  provider: string;
}

export interface ImageModel {
  id: string;
  name: string;
  provider: string;
}
