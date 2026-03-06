export type SessionKind = 'chat' | 'image' | 'studio';

export interface Session {
  id: number;
  kind: SessionKind;
  title: string;
  created_at: string;
  updated_at: string;
  messages?: Message[];
  image_records?: ImageRecord[];
  /** 이미지 세션 전용: 참고용 이미지 URL 1~2개 (세션 기준 저장, 이후 생성 요청마다 사용) */
  reference_image_urls?: string[];
}

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  created_at: string;
}

export interface ImageRecord {
  id: number;
  prompt: string;
  image_url: string;
  model: string;
  metadata?: {
    input_reference_urls?: string[];
    input_attachment_urls?: string[];
    input_image_urls?: string[];
    [key: string]: unknown;
  };
  created_at: string;
}

export interface DocumentItem {
  id: number;
  original_name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  file_url: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  document_id: number;
  document_name: string;
  page: number;
  bbox?: [number, number, number, number];
  bbox_norm?: [number, number, number, number];
  page_width?: number;
  page_height?: number;
  snippet?: string;
}

/** 채팅 job 결과 (판별기 점수, 검색 사용 여부 등, 백엔드 payload) */
export interface ChatJobResult {
  retrieval_score?: number;
  use_gemini_search?: boolean;
  external_context_used?: boolean;
}

export interface JobStatus {
  task_id: string;
  job_id: number;
  status: 'pending' | 'running' | 'success' | 'failure';
  kind?: 'chat' | 'image';
  result?: ChatJobResult;
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
