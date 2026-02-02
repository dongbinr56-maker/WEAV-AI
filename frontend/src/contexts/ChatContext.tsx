import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { chatApi } from '@/services/api/chatApi';
import { useApp } from './AppContext';
import { getDefaultImageOptions, type ImageGenOptions } from '@/constants/models';

const POLL_INTERVAL = 800;
const POLL_MAX = 60;
const DEFAULT_CHAT_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_IMAGE_MODEL = 'fal-ai/imagen4/preview';
const STORAGE_KEY = 'weav-session-models';

type SessionModels = Record<number, { chat: string; image: string }>;

function loadModelsFromStorage(): SessionModels {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { chat: string; image: string }>;
    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [Number(k), v])
    ) as SessionModels;
  } catch {
    return {};
  }
}

function saveModelsToStorage(models: SessionModels) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
  } catch {
    // ignore quota / private mode
  }
}

function getStoredModels(stored: SessionModels | undefined, sessionId: number) {
  const s = stored?.[sessionId];
  return { chat: s?.chat ?? DEFAULT_CHAT_MODEL, image: s?.image ?? DEFAULT_IMAGE_MODEL };
}

type RegenerateChatOptions = { model?: string; prompt?: string };

type RegeneratePromptState = { sessionId: number; prompt: string } | null;

type ChatContextValue = {
  sending: boolean;
  error: string | null;
  sendChatMessage: (prompt: string, model: string) => Promise<void>;
  sendImageRequest: (prompt: string, model: string, options?: { referenceImageId?: number; referenceImageUrl?: string } & Partial<ImageGenOptions>) => Promise<void>;
  stopGeneration: () => void;
  regenerateChat: (sessionId: number, options?: RegenerateChatOptions) => Promise<void>;
  regenerateImage: (sessionId: number, options?: { prompt?: string } & Partial<ImageGenOptions>) => Promise<void>;
  getChatModel: (sessionId: number) => string;
  setChatModel: (sessionId: number, model: string) => void;
  getImageModel: (sessionId: number) => string;
  setImageModel: (sessionId: number, model: string) => void;
  /** 연필 클릭 시 하단 입력창에 넣을 내용 (재질문 모드) */
  regeneratePrompt: RegeneratePromptState;
  setRegeneratePrompt: (sessionId: number, prompt: string) => void;
  clearRegeneratePrompt: () => void;
  /** 이미지 연필 클릭 시 하단 입력창에 넣을 내용 (이미지 재생성 모드) */
  regenerateImagePrompt: RegeneratePromptState;
  setRegenerateImagePrompt: (sessionId: number, prompt: string) => void;
  clearRegenerateImagePrompt: () => void;
  /** 이미지 생성 중인 질문 (질문 먼저 띄우기용) */
  pendingImageRequest: { sessionId: number; prompt: string } | null;
  /** 이미지 세션별 참조 이미지 ID (세션 내 생성 이미지 선택) */
  getReferenceImageId: (sessionId: number) => number | null;
  setReferenceImageId: (sessionId: number, imageRecordId: number | null) => void;
  /** 이미지 세션별 업로드한 참조 이미지 URL */
  getReferenceImageUrl: (sessionId: number) => string | null;
  setReferenceImageUrl: (sessionId: number, url: string | null) => void;
  /** 이미지 세션별 생성 옵션 (비율, 해상도, 포맷 등) */
  getImageSettings: (sessionId: number, modelId: string) => ImageGenOptions;
  setImageSettings: (sessionId: number, settings: Partial<ImageGenOptions>) => void;
  clearError: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { currentSession, refreshSession } = useApp();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelBySession, setModelBySession] = useState<SessionModels>(loadModelsFromStorage);
  const [regeneratePrompt, setRegeneratePromptState] = useState<RegeneratePromptState>(null);
  const [regenerateImagePrompt, setRegenerateImagePromptState] = useState<RegeneratePromptState>(null);
  const [pendingImageRequest, setPendingImageRequest] = useState<{ sessionId: number; prompt: string } | null>(null);
  const [referenceImageIdBySession, setReferenceImageIdBySession] = useState<Record<number, number | null>>({});
  const [referenceImageUrlBySession, setReferenceImageUrlBySession] = useState<Record<number, string | null>>({});
  const [imageSettingsBySession, setImageSettingsBySession] = useState<Record<number, Partial<ImageGenOptions>>>({});
  const modelBySessionRef = useRef<SessionModels>({});
  modelBySessionRef.current = modelBySession;

  useEffect(() => {
    saveModelsToStorage(modelBySession);
  }, [modelBySession]);

  const setRegeneratePrompt = useCallback((sessionId: number, prompt: string) => {
    setRegeneratePromptState({ sessionId, prompt });
  }, []);
  const clearRegeneratePrompt = useCallback(() => {
    setRegeneratePromptState(null);
  }, []);
  const setRegenerateImagePrompt = useCallback((sessionId: number, prompt: string) => {
    setRegenerateImagePromptState({ sessionId, prompt });
  }, []);
  const clearRegenerateImagePrompt = useCallback(() => {
    setRegenerateImagePromptState(null);
  }, []);
  const abortRef = useRef(false);
  const currentTaskIdRef = useRef<string | null>(null);
  const setSendingRef = useRef<(v: boolean) => void>(() => {});
  setSendingRef.current = setSending;

  const getChatModel = useCallback((sessionId: number) => getStoredModels(modelBySessionRef.current, sessionId).chat, []);
  const getImageModel = useCallback((sessionId: number) => getStoredModels(modelBySessionRef.current, sessionId).image, []);
  const setChatModel = useCallback((sessionId: number, model: string) => {
    setModelBySession((prev) => ({
      ...prev,
      [sessionId]: { ...getStoredModels(prev, sessionId), chat: model },
    }));
  }, []);
  const setImageModel = useCallback((sessionId: number, model: string) => {
    setModelBySession((prev) => ({
      ...prev,
      [sessionId]: { ...getStoredModels(prev, sessionId), image: model },
    }));
  }, []);
  const getReferenceImageId = useCallback((sessionId: number) => referenceImageIdBySession[sessionId] ?? null, [referenceImageIdBySession]);
  const setReferenceImageId = useCallback((sessionId: number, imageRecordId: number | null) => {
    setReferenceImageIdBySession((prev) => ({ ...prev, [sessionId]: imageRecordId }));
    if (imageRecordId != null) setReferenceImageUrlBySession((prev) => ({ ...prev, [sessionId]: null }));
  }, []);
  const getReferenceImageUrl = useCallback((sessionId: number) => referenceImageUrlBySession[sessionId] ?? null, [referenceImageUrlBySession]);
  const setReferenceImageUrl = useCallback((sessionId: number, url: string | null) => {
    setReferenceImageUrlBySession((prev) => ({ ...prev, [sessionId]: url }));
    if (url != null) setReferenceImageIdBySession((prev) => ({ ...prev, [sessionId]: null }));
  }, []);
  const getImageSettings = useCallback((sessionId: number, modelId: string): ImageGenOptions => {
    const defaults = getDefaultImageOptions(modelId);
    const overrides = imageSettingsBySession[sessionId];
    return { ...defaults, ...overrides };
  }, [imageSettingsBySession]);
  const setImageSettings = useCallback((sessionId: number, settings: Partial<ImageGenOptions>) => {
    setImageSettingsBySession((prev) => ({
      ...prev,
      [sessionId]: { ...prev[sessionId], ...settings },
    }));
  }, []);

  const pollJob = useCallback(
    async (taskId: string, sessionId: number) => {
      for (let i = 0; i < POLL_MAX; i++) {
        if (abortRef.current) {
          abortRef.current = false;
          currentTaskIdRef.current = null;
          return;
        }
        const status = await chatApi.jobStatus(taskId);
        if (status.status === 'success' || status.status === 'failure') {
          currentTaskIdRef.current = null;
          const isStillCurrent = await refreshSession(sessionId);
          if (status.status === 'failure' && status.error && isStillCurrent) setError(status.error);
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      }
      currentTaskIdRef.current = null;
      const isStillCurrent = await refreshSession(sessionId);
      if (isStillCurrent) setError('응답 대기 시간이 초과되었습니다.');
    },
    [refreshSession]
  );

  const stopGeneration = useCallback(() => {
    abortRef.current = true;
    setSendingRef.current(false);
    const taskId = currentTaskIdRef.current;
    if (taskId) {
      chatApi.cancelJob(taskId).catch(() => {});
      currentTaskIdRef.current = null;
    }
  }, []);

  const sendChatMessage = useCallback(
    async (prompt: string, model: string) => {
      if (!currentSession || currentSession.kind !== 'chat') return;
      const sessionId = currentSession.id;
      abortRef.current = false;
      setSending(true);
      setError(null);
      try {
        const res = await chatApi.completeChat(sessionId, prompt, model);
        currentTaskIdRef.current = res.task_id;
        await refreshSession(sessionId);
        await pollJob(res.task_id, sessionId);
      } catch (e) {
        currentTaskIdRef.current = null;
        setError(e instanceof Error ? e.message : '전송 실패');
      } finally {
        setSending(false);
      }
    },
    [currentSession, pollJob, refreshSession]
  );

  const sendImageRequest = useCallback(
    async (prompt: string, model: string, options?: { referenceImageId?: number; referenceImageUrl?: string } & Partial<ImageGenOptions>) => {
      if (!currentSession || currentSession.kind !== 'image') return;
      const sessionId = currentSession.id;
      abortRef.current = false;
      setSending(true);
      setError(null);
      setPendingImageRequest({ sessionId, prompt });
      const refUrl = options?.referenceImageUrl ?? referenceImageUrlBySession[sessionId] ?? null;
      const refId = refUrl == null ? (options?.referenceImageId ?? referenceImageIdBySession[sessionId] ?? null) : null;
      const settings = getImageSettings(sessionId, model);
      const merged = { ...settings, ...options };
      try {
        const res = await chatApi.completeImage(sessionId, prompt, model, {
          aspectRatio: merged.aspect_ratio,
          numImages: merged.num_images,
          ...(refUrl != null && refUrl !== '' && { referenceImageUrl: refUrl }),
          ...(refId != null && { referenceImageId: refId }),
          resolution: merged.resolution,
          outputFormat: merged.output_format,
          seed: merged.seed,
        });
        currentTaskIdRef.current = res.task_id;
        await refreshSession(sessionId);
        await pollJob(res.task_id, sessionId);
      } catch (e) {
        currentTaskIdRef.current = null;
        setError(e instanceof Error ? e.message : '생성 실패');
      } finally {
        setPendingImageRequest(null);
        setSending(false);
      }
    },
    [currentSession, getImageSettings, pollJob, refreshSession, referenceImageIdBySession, referenceImageUrlBySession]
  );

  const regenerateChat = useCallback(
    async (sessionId: number, options?: RegenerateChatOptions) => {
      if (!currentSession || currentSession.kind !== 'chat' || currentSession.id !== sessionId) return;
      const model = options?.model ?? getChatModel(sessionId);
      const prompt = options?.prompt;
      abortRef.current = false;
      setSending(true);
      setError(null);
      try {
        const res = await chatApi.regenerateChat(sessionId, model, prompt);
        currentTaskIdRef.current = res.task_id;
        await refreshSession(sessionId);
        await pollJob(res.task_id, sessionId);
      } catch (e) {
        currentTaskIdRef.current = null;
        setError(e instanceof Error ? e.message : '재생성 실패');
      } finally {
        setSending(false);
      }
    },
    [currentSession, pollJob, refreshSession, getChatModel]
  );

  const regenerateImage = useCallback(
    async (sessionId: number, options?: { prompt?: string } & Partial<ImageGenOptions>) => {
      if (!currentSession || currentSession.kind !== 'image' || currentSession.id !== sessionId) return;
      const prompt = options?.prompt;
      if (prompt != null) setPendingImageRequest({ sessionId, prompt });
      const imageModel = getImageModel(sessionId);
      const settings = getImageSettings(sessionId, imageModel);
      const merged = { ...settings, ...options };
      abortRef.current = false;
      setSending(true);
      setError(null);
      try {
        const res = await chatApi.regenerateImage(sessionId, {
          aspectRatio: merged.aspect_ratio,
          resolution: merged.resolution,
          outputFormat: merged.output_format,
          seed: merged.seed,
        });
        currentTaskIdRef.current = res.task_id;
        await refreshSession(sessionId);
        await pollJob(res.task_id, sessionId);
      } catch (e) {
        currentTaskIdRef.current = null;
        setError(e instanceof Error ? e.message : '재생성 실패');
      } finally {
        setPendingImageRequest(null);
        setSending(false);
      }
    },
    [currentSession, getImageModel, getImageSettings, pollJob, refreshSession]
  );

  const value: ChatContextValue = {
    sending,
    error,
    sendChatMessage,
    sendImageRequest,
    stopGeneration,
    regenerateChat,
    regenerateImage,
    getChatModel,
    setChatModel,
    getImageModel,
    setImageModel,
    regeneratePrompt,
    setRegeneratePrompt,
    clearRegeneratePrompt,
    regenerateImagePrompt,
    setRegenerateImagePrompt,
    clearRegenerateImagePrompt,
    pendingImageRequest,
    getReferenceImageId,
    setReferenceImageId,
    getReferenceImageUrl,
    setReferenceImageUrl,
    getImageSettings,
    setImageSettings,
    clearError: () => setError(null),
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
