import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { chatApi } from '@/services/api/chatApi';
import { useApp } from './AppContext';
import { getDefaultImageOptions, IMAGE_MODEL_ID_NANO_BANANA, normalizeChatModelId, normalizeImageModelId, type ImageGenOptions } from '@/constants/models';
import type { DocumentItem } from '@/types';

const POLL_INTERVAL = 800;
const CHAT_POLL_MAX = 60;
const IMAGE_POLL_MAX = 225;
const IMAGE_BACKGROUND_POLL_MAX = 750;
const DEFAULT_CHAT_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_IMAGE_MODEL = IMAGE_MODEL_ID_NANO_BANANA;
const STORAGE_KEY = 'weav-session-models';

type SessionModels = Record<number, { chat: string; image: string }>;

function loadModelsFromStorage(): SessionModels {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { chat: string; image: string }>;
    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [
        Number(k),
        { ...v, chat: normalizeChatModelId(v?.chat), image: normalizeImageModelId(v?.image) },
      ])
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
  return {
    chat: normalizeChatModelId(s?.chat ?? DEFAULT_CHAT_MODEL),
    image: normalizeImageModelId(s?.image ?? DEFAULT_IMAGE_MODEL),
  };
}

type RegenerateChatOptions = { model?: string; prompt?: string };

type RegeneratePromptState = { sessionId: number; prompt: string } | null;

type AttachmentItem = {
  previewUrl: string;
  remoteUrl?: string;
  status: 'uploading' | 'ready' | 'error';
};

type PendingImageRequestState = {
  sessionId: number;
  prompt: string;
  referenceImageUrls: string[];
  attachmentImageUrls: string[];
} | null;

type RegenerateImageOptions = { prompt?: string; model?: string } & Partial<ImageGenOptions>;

type ChatContextValue = {
  sending: boolean;
  error: string | null;
  sendChatMessage: (prompt: string, model: string) => Promise<void>;
  sendImageRequest: (prompt: string, model: string, options?: { referenceImageId?: number; referenceImageUrl?: string } & Partial<ImageGenOptions>) => Promise<boolean>;
  stopGeneration: () => void;
  regenerateChat: (sessionId: number, options?: RegenerateChatOptions) => Promise<void>;
  regenerateImage: (sessionId: number, options?: RegenerateImageOptions) => Promise<void>;
  getChatModel: (sessionId: number) => string;
  setChatModel: (sessionId: number, model: string) => void;
  getImageModel: (sessionId: number) => string;
  setImageModel: (sessionId: number, model: string) => void;
  /** 채팅 세션에서 입력 모드: 텍스트 대화 vs 이미지 생성 (통일 채팅방용) */
  getChatInputMode: (sessionId: number) => 'text' | 'image';
  setChatInputMode: (sessionId: number, mode: 'text' | 'image') => void;
  /** 연필 클릭 시 하단 입력창에 넣을 내용 (재질문 모드) */
  regeneratePrompt: RegeneratePromptState;
  setRegeneratePrompt: (sessionId: number, prompt: string) => void;
  clearRegeneratePrompt: () => void;
  /** 이미지 연필 클릭 시 하단 입력창에 넣을 내용 (이미지 재생성 모드) */
  regenerateImagePrompt: RegeneratePromptState;
  setRegenerateImagePrompt: (sessionId: number, prompt: string) => void;
  clearRegenerateImagePrompt: () => void;
  /** 이미지 생성 중인 질문 (질문 먼저 띄우기용) */
  pendingImageRequest: PendingImageRequestState;
  /** 이미지 세션별 참조 이미지 ID (세션 내 생성 이미지 선택) */
  getReferenceImageId: (sessionId: number) => number | null;
  setReferenceImageId: (sessionId: number, imageRecordId: number | null) => void;
  /** 이미지 세션별 업로드한 참조 이미지 URL */
  getReferenceImageUrl: (sessionId: number) => string | null;
  setReferenceImageUrl: (sessionId: number, url: string | null) => void;
  /** 이미지 세션별 첨부 이미지 URL 목록 */
  getAttachmentItems: (sessionId: number) => AttachmentItem[];
  updateAttachmentItems: (sessionId: number, updater: (items: AttachmentItem[]) => AttachmentItem[]) => void;
  removeAttachmentItem: (sessionId: number, index: number) => void;
  clearAttachmentItems: (sessionId: number) => void;
  /** 이미지 세션별 생성 옵션 (비율, 해상도, 포맷 등) */
  getImageSettings: (sessionId: number, modelId: string) => ImageGenOptions;
  setImageSettings: (sessionId: number, settings: Partial<ImageGenOptions>) => void;
  /** 세션별 문서 목록 */
  getDocuments: (sessionId: number) => DocumentItem[];
  refreshDocuments: (sessionId: number) => Promise<DocumentItem[]>;
  uploadDocument: (sessionId: number, file: File) => Promise<DocumentItem[]>;
  deleteDocument: (sessionId: number, documentId: number) => Promise<DocumentItem[]>;
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
  const [pendingImageRequest, setPendingImageRequest] = useState<PendingImageRequestState>(null);
  const [referenceImageIdBySession, setReferenceImageIdBySession] = useState<Record<number, number | null>>({});
  const [referenceImageUrlBySession, setReferenceImageUrlBySession] = useState<Record<number, string | null>>({});
  const [attachmentItemsBySession, setAttachmentItemsBySession] = useState<Record<number, AttachmentItem[]>>({});
  const [imageSettingsBySession, setImageSettingsBySession] = useState<Record<number, Partial<ImageGenOptions>>>({});
  const [chatInputModeBySession, setChatInputModeBySession] = useState<Record<number, 'text' | 'image'>>({});
  const [documentsBySession, setDocumentsBySession] = useState<Record<number, DocumentItem[]>>({});
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
  const backgroundImagePollsRef = useRef<Set<string>>(new Set());
  const setSendingRef = useRef<(v: boolean) => void>(() => {});
  setSendingRef.current = setSending;

  const getChatModel = useCallback((sessionId: number) => getStoredModels(modelBySessionRef.current, sessionId).chat, []);
  const getImageModel = useCallback((sessionId: number) => getStoredModels(modelBySessionRef.current, sessionId).image, []);
  const setChatModel = useCallback((sessionId: number, model: string) => {
    const normalized = normalizeChatModelId(model);
    setModelBySession((prev) => ({
      ...prev,
      [sessionId]: { ...getStoredModels(prev, sessionId), chat: normalized },
    }));
  }, []);
  const setImageModel = useCallback((sessionId: number, model: string) => {
    const normalized = normalizeImageModelId(model);
    setModelBySession((prev) => ({
      ...prev,
      [sessionId]: { ...getStoredModels(prev, sessionId), image: normalized },
    }));
  }, []);
  const getChatInputMode = useCallback((sessionId: number) => chatInputModeBySession[sessionId] ?? 'text', [chatInputModeBySession]);
  const setChatInputMode = useCallback((sessionId: number, mode: 'text' | 'image') => {
    if (mode === 'image') {
      setModelBySession((prev) => (
        prev[sessionId]
          ? prev
          : {
              ...prev,
              [sessionId]: { ...getStoredModels(prev, sessionId), image: DEFAULT_IMAGE_MODEL },
            }
      ));
      setImageSettingsBySession((prev) => (
        prev[sessionId]
          ? prev
          : {
              ...prev,
              [sessionId]: getDefaultImageOptions(DEFAULT_IMAGE_MODEL),
            }
      ));
    }
    setChatInputModeBySession((prev) => ({ ...prev, [sessionId]: mode }));
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
  const getAttachmentItems = useCallback(
    (sessionId: number) => attachmentItemsBySession[sessionId] ?? [],
    [attachmentItemsBySession]
  );
  const updateAttachmentItems = useCallback(
    (sessionId: number, updater: (items: AttachmentItem[]) => AttachmentItem[]) => {
      setAttachmentItemsBySession((prev) => {
        const prevItems = prev[sessionId] ?? [];
        const nextItems = updater(prevItems);
        if (typeof URL !== 'undefined') {
          const prevSet = new Set(prevItems.map((i) => i.previewUrl).filter(Boolean));
          const nextSet = new Set(nextItems.map((i) => i.previewUrl).filter(Boolean));
          prevSet.forEach((url) => {
            if (!nextSet.has(url)) URL.revokeObjectURL(url);
          });
        }
        return { ...prev, [sessionId]: nextItems };
      });
    },
    []
  );
  const removeAttachmentItem = useCallback(
    (sessionId: number, index: number) => {
      updateAttachmentItems(sessionId, (prev) => prev.filter((_, i) => i !== index));
    },
    [updateAttachmentItems]
  );
  const clearAttachmentItems = useCallback(
    (sessionId: number) => {
      updateAttachmentItems(sessionId, () => []);
    },
    [updateAttachmentItems]
  );
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
  const getDocuments = useCallback(
    (sessionId: number) => documentsBySession[sessionId] ?? [],
    [documentsBySession]
  );
  const refreshDocuments = useCallback(async (sessionId: number) => {
    const docs = await chatApi.listDocuments(sessionId);
    setDocumentsBySession((prev) => ({ ...prev, [sessionId]: docs }));
    return docs;
  }, []);
  const uploadDocument = useCallback(async (sessionId: number, file: File) => {
    await chatApi.uploadDocument(sessionId, file);
    return refreshDocuments(sessionId);
  }, [refreshDocuments]);
  const deleteDocument = useCallback(
    async (sessionId: number, documentId: number) => {
      await chatApi.deleteDocument(sessionId, documentId);
      setDocumentsBySession((prev) => ({
        ...prev,
        [sessionId]: (prev[sessionId] ?? []).filter((doc) => doc.id !== documentId),
      }));
      return refreshDocuments(sessionId);
    },
    [refreshDocuments]
  );

  const pollJobInBackground = useCallback(
    async (taskId: string, sessionId: number) => {
      if (backgroundImagePollsRef.current.has(taskId)) return;
      backgroundImagePollsRef.current.add(taskId);
      try {
        for (let i = 0; i < IMAGE_BACKGROUND_POLL_MAX; i++) {
          const status = await chatApi.jobStatus(taskId).catch(() => null);
          if (!status) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
            continue;
          }
          if (status.status === 'success' || status.status === 'failure') {
            const isStillCurrent = await refreshSession(sessionId);
            if (status.status === 'failure' && status.error && isStillCurrent) setError(status.error);
            return;
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        }
      } finally {
        backgroundImagePollsRef.current.delete(taskId);
      }
    },
    [refreshSession]
  );

  const pollJob = useCallback(
    async (
      taskId: string,
      sessionId: number,
      options?: { maxAttempts?: number; timeoutMessage?: string; continueInBackground?: boolean }
    ) => {
      const maxAttempts = options?.maxAttempts ?? CHAT_POLL_MAX;
      for (let i = 0; i < maxAttempts; i++) {
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
      if (options?.continueInBackground) {
        await refreshSession(sessionId);
        void pollJobInBackground(taskId, sessionId);
        return;
      }
      const isStillCurrent = await refreshSession(sessionId);
      if (isStillCurrent) setError(options?.timeoutMessage ?? '응답 대기 시간이 초과되었습니다.');
    },
    [pollJobInBackground, refreshSession]
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
        await pollJob(res.task_id, sessionId, { maxAttempts: CHAT_POLL_MAX });
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
    async (
      prompt: string,
      model: string,
      options?: { referenceImageId?: number; referenceImageUrl?: string; imageUrls?: string[] } & Partial<ImageGenOptions>
    ) => {
      if (!currentSession) return false;
      const isImageSession = currentSession.kind === 'image';
      const isChatWithImageMode = currentSession.kind === 'chat' && getChatInputMode(currentSession.id) === 'image';
      if (!isImageSession && !isChatWithImageMode) return false;
      const sessionId = currentSession.id;
      let succeeded = false;
      abortRef.current = false;
      setSending(true);
      setError(null);
      // 세션 참고 이미지가 있으면 백엔드가 사용하므로 요청에 참조를 넣지 않음
      const useSessionRefs = (currentSession.reference_image_urls?.length ?? 0) > 0;
      const refUrl = useSessionRefs ? null : (options?.referenceImageUrl ?? referenceImageUrlBySession[sessionId] ?? null);
      const refId = refUrl == null ? (options?.referenceImageId ?? referenceImageIdBySession[sessionId] ?? null) : null;
      const attachmentUrls =
        options?.imageUrls ??
        getAttachmentItems(sessionId)
          .map((item) => item.remoteUrl)
          .filter((u): u is string => Boolean(u));
      const referenceImageUrls = useSessionRefs
        ? (currentSession.reference_image_urls ?? []).filter((u): u is string => Boolean(u)).slice(0, 2)
        : (refUrl ? [refUrl] : []);
      setPendingImageRequest({
        sessionId,
        prompt,
        referenceImageUrls,
        attachmentImageUrls: attachmentUrls,
      });
      const settings = getImageSettings(sessionId, model);
      const merged = { ...settings, ...options };
      try {
        const res = await chatApi.completeImage(sessionId, prompt, model, {
          aspectRatio: merged.aspect_ratio,
          numImages: merged.num_images,
          ...(refUrl != null && refUrl !== '' && { referenceImageUrl: refUrl }),
          ...(refId != null && { referenceImageId: refId }),
          ...(useSessionRefs && (currentSession.reference_image_urls?.length ?? 0) > 0 && { referenceImageUrls: currentSession.reference_image_urls }),
          ...(attachmentUrls.length > 0 && { imageUrls: attachmentUrls }),
          resolution: merged.resolution,
          outputFormat: merged.output_format,
          seed: merged.seed,
        });
        currentTaskIdRef.current = res.task_id;
        await refreshSession(sessionId);
        await pollJob(res.task_id, sessionId, {
          maxAttempts: IMAGE_POLL_MAX,
          continueInBackground: true,
        });
        succeeded = true;
      } catch (e) {
        currentTaskIdRef.current = null;
        setError(e instanceof Error ? e.message : '생성 실패');
      } finally {
        setPendingImageRequest(null);
        setSending(false);
      }
      return succeeded;
    },
    [currentSession, getChatInputMode, getImageSettings, getAttachmentItems, pollJob, refreshSession, referenceImageIdBySession, referenceImageUrlBySession]
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
        await pollJob(res.task_id, sessionId, { maxAttempts: CHAT_POLL_MAX });
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
    async (sessionId: number, options?: RegenerateImageOptions) => {
      if (!currentSession || currentSession.id !== sessionId) return;
      const isImageSession = currentSession.kind === 'image';
      const isChatWithImageMode = currentSession.kind === 'chat' && getChatInputMode(sessionId) === 'image';
      if (!isImageSession && !isChatWithImageMode) return;
      const prompt = options?.prompt;
      const useSessionRefs = (currentSession.reference_image_urls?.length ?? 0) > 0;
      const refUrl = useSessionRefs ? null : (referenceImageUrlBySession[sessionId] ?? null);
      const refId = refUrl == null ? (referenceImageIdBySession[sessionId] ?? null) : null;
      const attachmentUrls = getAttachmentItems(sessionId)
        .map((item) => item.remoteUrl)
        .filter((u): u is string => Boolean(u));
      const referenceImageUrls = useSessionRefs
        ? (currentSession.reference_image_urls ?? []).filter((u): u is string => Boolean(u)).slice(0, 2)
        : (refUrl ? [refUrl] : []);
      if (prompt != null) {
        setPendingImageRequest({
          sessionId,
          prompt,
          referenceImageUrls,
          attachmentImageUrls: attachmentUrls,
        });
      }
      const imageModel = options?.model ?? getImageModel(sessionId);
      const settings = getImageSettings(sessionId, imageModel);
      const merged = { ...settings, ...options };
      abortRef.current = false;
      setSending(true);
      setError(null);
      try {
        const res = await chatApi.regenerateImage(sessionId, {
          prompt: prompt?.trim() || undefined,
          model: imageModel,
          aspectRatio: merged.aspect_ratio,
          ...(refUrl != null && refUrl !== '' && { referenceImageUrl: refUrl }),
          ...(refId != null && { referenceImageId: refId }),
          ...(useSessionRefs && referenceImageUrls.length > 0 && { referenceImageUrls }),
          ...(attachmentUrls.length > 0 && { imageUrls: attachmentUrls }),
          resolution: merged.resolution,
          outputFormat: merged.output_format,
          seed: merged.seed,
        });
        currentTaskIdRef.current = res.task_id;
        await refreshSession(sessionId);
        await pollJob(res.task_id, sessionId, {
          maxAttempts: IMAGE_POLL_MAX,
          continueInBackground: true,
        });
      } catch (e) {
        currentTaskIdRef.current = null;
        setError(e instanceof Error ? e.message : '재생성 실패');
      } finally {
        setPendingImageRequest(null);
        setSending(false);
      }
    },
    [currentSession, getAttachmentItems, getChatInputMode, getImageModel, getImageSettings, pollJob, refreshSession, referenceImageIdBySession, referenceImageUrlBySession]
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
    getChatInputMode,
    setChatInputMode,
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
    getAttachmentItems,
    updateAttachmentItems,
    removeAttachmentItem,
    clearAttachmentItems,
    getImageSettings,
    setImageSettings,
    getDocuments,
    refreshDocuments,
    uploadDocument,
    deleteDocument,
    clearError: () => setError(null),
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
