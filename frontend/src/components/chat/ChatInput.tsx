import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Settings2, Upload, X, ArrowUp, ImagePlus, Info, Plus, Mic } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useChat } from '@/contexts/ChatContext';
import { useLayout } from '@/contexts/LayoutContext';
import {
  IMAGE_MODEL_SETTINGS,
  CHAT_PROMPT_MAX_LENGTH,
  CHAT_PROMPT_MAX_LENGTH_BY_MODEL,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_PROMPT_MAX_LENGTH_BY_MODEL,
  IMAGE_MODEL_ID_IMAGEN4,
  IMAGE_MODEL_ID_FLUX,
  IMAGE_MODEL_ID_GEMINI,
  IMAGE_MODEL_ID_NANO_BANANA,
  IMAGE_MODEL_ID_NANO_BANANA_2,
  imageModelSupportsReference,
  validateChatPrompt,
  validateImagePrompt,
} from '@/constants/models';
import { chatApi } from '@/services/api/chatApi';
import { useToast } from '@/contexts/ToastContext';
import { ModelSelector } from './ModelSelector';
import { getImageModelGuide } from './imageModelGuide';

export function ChatInput({
  rightOffset = 0,
  onHeightChange,
  onSubmitStart,
  focusComposerSignal = 0,
}: {
  rightOffset?: number;
  onHeightChange?: (height: number) => void;
  onSubmitStart?: () => void;
  focusComposerSignal?: number;
}) {
  const { currentSession } = useApp();
  const {
    sendChatMessage,
    sendImageRequest,
    sending,
    error,
    clearError,
    stopGeneration,
    getChatModel,
    setChatModel,
    getChatInputMode,
    setChatInputMode,
    getImageModel,
    setImageModel,
    getImageSettings,
    setImageSettings,
    getDocuments,
    refreshDocuments,
    regeneratePrompt,
    clearRegeneratePrompt,
    regenerateChat,
    regenerateImagePrompt,
    clearRegenerateImagePrompt,
    regenerateImage,
    getReferenceImageId,
    setReferenceImageId,
    getReferenceImageUrl,
    setReferenceImageUrl,
    getAttachmentItems,
    updateAttachmentItems,
    removeAttachmentItem,
    clearAttachmentItems,
  } = useChat();
  const { showToast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [modelInfoOpen, setModelInfoOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const modelInfoRef = useRef<HTMLDivElement>(null);
  const [maxTextareaHeight, setMaxTextareaHeight] = useState<number | null>(null);

  if (!currentSession) return null;

  const chatModel = getChatModel(currentSession.id);
  const imageModel = getImageModel(currentSession.id);
  const isChat = currentSession.kind === 'chat';
  const isImageMode = isChat ? getChatInputMode(currentSession.id) === 'image' : true;
  const showImageFeatures = isImageMode;
  const isRegenerateMode =
    isChat && !isImageMode && regeneratePrompt != null && regeneratePrompt.sessionId === currentSession.id;
  const isRegenerateImageMode =
    showImageFeatures && regenerateImagePrompt != null && regenerateImagePrompt.sessionId === currentSession.id;
  const modelSettings = showImageFeatures ? IMAGE_MODEL_SETTINGS[imageModel] : null;
  const imageSettings = showImageFeatures ? getImageSettings(currentSession.id, imageModel) : null;
  const sessionId = currentSession.id;
  const attachmentItems = showImageFeatures ? getAttachmentItems(sessionId) : [];
  const attachmentCount = attachmentItems.length;
  const referenceImageId = showImageFeatures ? getReferenceImageId(sessionId) : null;
  const referenceImageUrl = showImageFeatures ? getReferenceImageUrl(sessionId) : null;
  const hasReference = showImageFeatures && (referenceImageId != null || referenceImageUrl != null);
  const documents = isChat ? getDocuments(sessionId) : [];
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(0);

  const getAttachmentPolicy = () => {
    if (!showImageFeatures) return { maxCount: 0, blockMessage: '' };
    const isRegenLimited = isRegenerateImageMode;
    if (imageModel === IMAGE_MODEL_ID_NANO_BANANA) {
      const baseMax = hasReference ? 1 : 2;
      return { maxCount: isRegenLimited ? Math.min(1, baseMax) : baseMax, blockMessage: '' };
    }
    if (imageModel === IMAGE_MODEL_ID_IMAGEN4 || imageModel === IMAGE_MODEL_ID_FLUX || imageModel === IMAGE_MODEL_ID_GEMINI) {
      return {
        maxCount: 0,
        blockMessage: '이 모델은 이미지 첨부를 지원하지 않습니다. Nano Banana를 사용하세요.',
      };
    }
    return { maxCount: 0, blockMessage: '이 모델은 이미지 첨부를 지원하지 않습니다.' };
  };

  const attachmentPolicy = getAttachmentPolicy();
  const maxAttachments = attachmentPolicy.maxCount;
  const modelGuide = showImageFeatures ? getImageModelGuide(imageModel, { hasReference }) : null;

  useEffect(() => {
    if (regeneratePrompt?.sessionId === currentSession?.id) {
      setPrompt(regeneratePrompt.prompt);
      inputRef.current?.focus();
    }
  }, [regeneratePrompt?.sessionId, regeneratePrompt?.prompt, currentSession?.id]);

  useEffect(() => {
    if (regenerateImagePrompt?.sessionId === currentSession?.id) {
      setPrompt(regenerateImagePrompt.prompt);
      inputRef.current?.focus();
    }
  }, [regenerateImagePrompt?.sessionId, regenerateImagePrompt?.prompt, currentSession?.id]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [focusComposerSignal]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight || '0') || 20;
    const padTop = Number.parseFloat(style.paddingTop || '0') || 0;
    const padBottom = Number.parseFloat(style.paddingBottom || '0') || 0;
    setMaxTextareaHeight(lineHeight * 4 + padTop + padBottom);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !onHeightChange) return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height ?? 0;
      onHeightChange(h);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [onHeightChange]);

  useEffect(() => {
    if (showImageFeatures) {
      setMentionOpen(false);
      setMentionQuery('');
    }
  }, [showImageFeatures]);

  useEffect(() => {
    if (!showImageFeatures) setModelInfoOpen(false);
  }, [showImageFeatures]);

  useEffect(() => {
    if (!modelInfoOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (!modelInfoRef.current) return;
      if (!modelInfoRef.current.contains(e.target as Node)) {
        setModelInfoOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [modelInfoOpen]);

  useEffect(() => {
    if (isChat && currentSession) {
      refreshDocuments(currentSession.id).catch(() => {});
    }
  }, [isChat, currentSession?.id, refreshDocuments]);

  const updateMentionState = (value: string, caret: number) => {
    if (!isChat || showImageFeatures) {
      setMentionOpen(false);
      setMentionQuery('');
      return;
    }
    const upto = value.slice(0, caret);
    const quotedMatch = /@"([^"]*)$/.exec(upto);
    const match = /@([^\s@]*)$/.exec(upto);
    const activeMatch = quotedMatch ?? match;
    if (activeMatch) {
      setMentionOpen(true);
      setMentionQuery(activeMatch[1]);
      const startIndex = activeMatch.index ?? (caret - activeMatch[1].length - 1);
      setMentionStart(startIndex);
      setMentionIndex(0);
      refreshDocuments(sessionId).catch(() => {});
    } else {
      setMentionOpen(false);
      setMentionQuery('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || sending) return;
    let effectiveImageModel = imageModel;

    if (showImageFeatures) {
      if (hasAnyReferenceImage) {
        effectiveImageModel = ensureReferenceCompatibleModel(imageModel);
      }
      const result = validateImagePrompt(text, effectiveImageModel);
      if (!result.valid) {
        showToast(result.message);
        return;
      }
      if (attachmentCount > maxAttachments) {
        showToast(attachmentPolicy.blockMessage || `이미지는 최대 ${maxAttachments}개까지 첨부 가능합니다.`);
        return;
      }
      if (maxAttachments === 0 && attachmentCount > 0) {
        showToast(attachmentPolicy.blockMessage || '이 모델은 이미지 첨부를 지원하지 않습니다.');
        return;
      }
      if (attachmentItems.some((item) => !item.remoteUrl)) {
        showToast('이미지 업로드가 완료될 때까지 기다려 주세요.');
        return;
      }
    } else {
      const result = validateChatPrompt(text, chatModel);
      if (!result.valid) {
        showToast(result.message);
        return;
      }
    }

    onSubmitStart?.();
    setPrompt('');
    setMentionOpen(false);
    if (isRegenerateMode && currentSession) {
      clearRegeneratePrompt();
      await regenerateChat(currentSession.id, { prompt: text, model: chatModel });
    } else if (isRegenerateImageMode && currentSession) {
      clearRegenerateImagePrompt();
      await regenerateImage(currentSession.id, { prompt: text, model: effectiveImageModel });
    } else if (showImageFeatures) {
      const success = await sendImageRequest(text, effectiveImageModel);
      if (success) {
        clearAttachmentItems(sessionId);
        setReferenceImageUrl(sessionId, null);
        setReferenceImageId(sessionId, null);
      }
    } else {
      await sendChatMessage(text, chatModel);
    }
    // 전송 후 포커스 유지 (한 프레임 뒤에 실행해 스크롤 후에 적용)
    const inputEl = inputRef.current;
    requestAnimationFrame(() => {
      inputEl?.focus({ preventScroll: true });
    });
  };

  const sortedDocuments = isChat
    ? [...documents].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : [];
  const mentionCandidates = isChat
    ? sortedDocuments.filter((doc) =>
        doc.original_name.toLowerCase().includes(mentionQuery.toLowerCase())
      )
    : [];
  const mentionVisible = !showImageFeatures && mentionOpen && mentionCandidates.length > 0;

  const selectMention = (docName: string) => {
    const input = inputRef.current;
    if (!input) return;
    const caret = input.selectionStart ?? prompt.length;
    const before = prompt.slice(0, mentionStart);
    const after = prompt.slice(caret);
    const insertion = /\\s/.test(docName) ? `@"${docName}"` : `@${docName}`;
    const spacer = after.startsWith(' ') || after === '' ? ' ' : ' ';
    const next = `${before}${insertion}${spacer}${after}`;
    setPrompt(next);
    setMentionOpen(false);
    setMentionQuery('');
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length + spacer.length;
      input.setSelectionRange(pos, pos);
      input.focus();
    });
  };

  const formatDocTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yy}-${mm}-${dd} ${hh}:${min}`;
  };

  const handleUploadReference = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentSession) return;
    if (!showImageFeatures) return;
    if (!file.type.startsWith('image/')) {
      showToast('이미지 파일만 업로드할 수 있습니다 (JPEG, PNG, WebP)');
      return;
    }
    ensureReferenceCompatibleModel(imageModel);
    setUploadingRef(true);
    try {
      const { url } = await chatApi.uploadReferenceImage(file);
      setReferenceImageUrl(currentSession.id, url);
      showToast('참조 이미지가 업로드되었습니다');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setUploadingRef(false);
    }
  };

  const handleUploadAttachments = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length || !currentSession || !showImageFeatures) return;
    if (maxAttachments <= 0) {
      showToast(attachmentPolicy.blockMessage || '이 모델은 이미지 첨부를 지원하지 않습니다.');
      return;
    }
    if (files.some((f) => !f.type.startsWith('image/'))) {
      showToast('이미지 파일만 업로드할 수 있습니다 (JPEG, PNG, WebP)');
      return;
    }
    const remaining = maxAttachments - attachmentCount;
    if (remaining <= 0) {
      showToast(attachmentPolicy.blockMessage || `이미지는 최대 ${maxAttachments}개까지 첨부 가능합니다.`);
      return;
    }
    const toUpload = files.slice(0, remaining);
    const previewItems = toUpload.map((file) => ({
      previewUrl: URL.createObjectURL(file),
      status: 'uploading' as const,
    }));
    setUploadingAttachments(true);
    updateAttachmentItems(sessionId, (prev) => [...prev, ...previewItems]);
    try {
      const { urls } = await chatApi.uploadImageAttachments(toUpload);
      updateAttachmentItems(sessionId, (prev) => {
        const urlMap = new Map(previewItems.map((item, idx) => [item.previewUrl, urls[idx]]));
        return prev.map((item) => {
          const remote = urlMap.get(item.previewUrl);
          if (!remote) return item;
          return { ...item, remoteUrl: remote, status: 'ready' };
        });
      });
      if (files.length > remaining) {
        showToast(attachmentPolicy.blockMessage || `이미지는 최대 ${maxAttachments}개까지 첨부 가능합니다.`);
      }
    } catch (err) {
      updateAttachmentItems(sessionId, (prev) =>
        prev.map((item) => (previewItems.some((p) => p.previewUrl === item.previewUrl) ? { ...item, status: 'error' } : item))
      );
      showToast(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setUploadingAttachments(false);
    }
  };

  const handleAttachmentClick = () => {
    if (maxAttachments <= 0) {
      showToast(attachmentPolicy.blockMessage || '이 모델은 이미지 첨부를 지원하지 않습니다.');
      return;
    }
    attachInputRef.current?.click();
  };

  const handlePlusClick = () => {
    if (!isChat) {
      handleAttachmentClick();
      return;
    }
    if (!showImageFeatures) {
      setChatInputMode(currentSession.id, 'image');
      showToast('이미지 모드로 전환되었습니다. + 버튼으로 이미지를 첨부하세요.');
      return;
    }
    handleAttachmentClick();
  };

  const handleMicClick = () => {
    showToast('음성 입력은 준비 중입니다.');
  };

  const supportsReference = showImageFeatures && imageModelSupportsReference(imageModel);
  const hasRefImage = hasReference;
  const hasSessionReferenceImages = showImageFeatures && (currentSession.reference_image_urls?.length ?? 0) > 0;
  const hasAnyReferenceImage = hasRefImage || hasSessionReferenceImages;

  const ensureReferenceCompatibleModel = (candidateModel: string) => {
    if (imageModelSupportsReference(candidateModel)) return candidateModel;
    const nextModel = IMAGE_MODEL_ID_NANO_BANANA_2;
    setImageModel(currentSession.id, nextModel);
    setModelInfoOpen(false);
    showToast('참조 이미지 재생성은 Nano Banana Pro 또는 Nano Banana 2에서 지원됩니다. Nano Banana 2로 자동 전환했습니다.');
    return nextModel;
  };

  const handleImageModelChange = (nextModel: string) => {
    if (nextModel === imageModel) return;
    setImageModel(currentSession.id, nextModel);
    setModelInfoOpen(false);
    showToast(getImageModelGuide(nextModel, { hasReference }).toast);
  };

  const promptMaxLen = showImageFeatures
    ? (IMAGE_PROMPT_MAX_LENGTH_BY_MODEL[imageModel] ?? IMAGE_PROMPT_MAX_LENGTH)
    : (CHAT_PROMPT_MAX_LENGTH_BY_MODEL[chatModel] ?? CHAT_PROMPT_MAX_LENGTH);
  const showCharCount = prompt.length > 0 && prompt.length >= promptMaxLen * 0.8;
  const isOverLimit = prompt.length > promptMaxLen;

  const { sidebarOpen } = useLayout();

  const resizeTextarea = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = maxTextareaHeight ?? el.scrollHeight;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > next ? 'auto' : 'hidden';
  };

  useEffect(() => {
    resizeTextarea();
  }, [prompt, maxTextareaHeight]);

  return (
      <div
        ref={containerRef}
        className={`fixed bottom-0 right-0 p-4 transition-[left,right] duration-200 ease-out ${
          sidebarOpen ? 'left-72' : 'left-0'
        }`}
        style={rightOffset > 0 ? { right: rightOffset } : undefined}
      >
      {error && (
        <div className="max-w-3xl mx-auto mb-2 flex items-center justify-between rounded-lg border border-destructive/45 bg-destructive/18 text-destructive-foreground px-3 py-2 text-sm animate-fade-in-up">
          <span>{error}</span>
          <button type="button" onClick={clearError} className="hover:text-primary transition-colors duration-200">
            닫기
          </button>
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="max-w-[min(880px,calc(100vw-2rem))] mx-auto rounded-[30px] border border-border/40 bg-card/52 backdrop-blur-2xl overflow-visible transition-[opacity] duration-200 ease-out shadow-[0_18px_60px_hsl(var(--background)/0.55),inset_0_1px_0_hsl(var(--foreground)/0.04)]"
      >
        {/* 위쪽: 미디어 버튼 + 입력 + 전송 */}
        <div className="flex items-start gap-2 px-4 pt-3 pb-2 transition-opacity duration-200 ease-out">
          <input
            ref={attachInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            multiple
            onChange={handleUploadAttachments}
            disabled={uploadingAttachments || sending}
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleUploadReference}
            disabled={uploadingRef || sending}
          />
          <div className="relative flex-1 px-2 py-1.5">
            <textarea
              ref={inputRef}
              rows={1}
              value={prompt}
              onChange={(e) => {
                const value = e.target.value;
                setPrompt(value);
                const caret = e.target.selectionStart ?? value.length;
                updateMentionState(value, caret);
                resizeTextarea();
              }}
              onKeyDown={(e) => {
                if ((e.nativeEvent as KeyboardEvent).isComposing) return;
                if (e.key === 'Enter' && !e.shiftKey && !mentionVisible) {
                  e.preventDefault();
                  const form = (e.currentTarget as HTMLTextAreaElement).form;
                  if (form) form.requestSubmit();
                  return;
                }
                if (!mentionVisible) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionIndex((prev) => (prev + 1) % mentionCandidates.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionIndex((prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const selected = mentionCandidates[mentionIndex];
                  if (selected) selectMention(selected.original_name);
                } else if (e.key === 'Tab') {
                  e.preventDefault();
                  const selected = mentionCandidates[mentionIndex];
                  if (selected) selectMention(selected.original_name);
                } else if (e.key === 'Escape') {
                  setMentionOpen(false);
                }
              }}
              placeholder={
                isRegenerateMode
                  ? '수정 후 Enter 또는 재질문 버튼으로 재생성'
                  : isRegenerateImageMode
                    ? '수정 후 Enter 또는 재생성 버튼으로 재생성'
                    : showImageFeatures
                      ? '이미지 설명을 입력하세요...'
                      : '메시지를 입력하세요...'
              }
              className="w-full min-h-[102px] max-h-[240px] bg-transparent p-0 pr-10 text-base text-foreground placeholder-muted-foreground border-0 focus:outline-none focus:ring-0 resize-none leading-7"
              disabled={sending}
              maxLength={promptMaxLen}
              aria-invalid={isOverLimit}
              aria-describedby={showCharCount ? 'prompt-char-count' : undefined}
            />
            {showCharCount && (
              <span
                id="prompt-char-count"
                className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums pointer-events-none ${isOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}
                aria-live="polite"
              >
                {prompt.length.toLocaleString()} / {(promptMaxLen / 1000).toFixed(0)}천
              </span>
            )}
            {mentionVisible && (
              <div className="absolute left-0 right-0 bottom-full mb-2 z-20 rounded-2xl border border-border/65 bg-card/94 backdrop-blur-xl overflow-hidden">
                <div className="max-h-56 overflow-y-auto">
                  {mentionCandidates.map((doc, idx) => (
                    <button
                      key={`${doc.id}-${doc.original_name}`}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/70 transition-colors ${
                        idx === mentionIndex ? 'bg-muted/70' : ''
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectMention(doc.original_name);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-foreground">{doc.original_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {doc.status === 'completed' ? '완료' : doc.status === 'failed' ? '실패' : '처리 중'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {formatDocTime(doc.created_at)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {showImageFeatures && (attachmentCount > 0 || hasRefImage) && (
          <div className="px-3 pb-1">
            <div className="flex flex-wrap gap-2">
              {hasRefImage && (
                <div className="inline-flex items-center gap-2 rounded-full border border-border/65 bg-secondary/52 pl-1.5 pr-3 py-1">
                  {referenceImageUrl ? (
                    <img src={referenceImageUrl} alt="참조 이미지" className="w-7 h-7 rounded-full object-cover border border-border/70" />
                  ) : (
                    <div className="w-7 h-7 rounded-full border border-border/70 bg-muted/40 flex items-center justify-center text-[10px] text-muted-foreground">
                      REF
                    </div>
                  )}
                  <span className="text-xs text-foreground">참조 이미지</span>
                  <button
                    type="button"
                    onClick={() => {
                      setReferenceImageUrl(currentSession.id, null);
                      setReferenceImageId(currentSession.id, null);
                    }}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/75"
                    aria-label="참조 이미지 삭제"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              {attachmentItems.map((item, idx) => (
                <div key={`${item.previewUrl}-${idx}`} className="inline-flex items-center gap-2 rounded-full border border-border/65 bg-secondary/52 pl-1.5 pr-3 py-1">
                  <div className="relative">
                    <img src={item.previewUrl || item.remoteUrl} alt={`attachment-${idx + 1}`} className="w-7 h-7 rounded-full object-cover border border-border/70" />
                    {item.status === 'uploading' && (
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-card px-1 text-[9px] leading-4 border border-border/70">…</span>
                    )}
                    {item.status === 'error' && (
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-destructive/20 px-1 text-[9px] leading-4 border border-destructive/50">!</span>
                    )}
                  </div>
                  <span className="text-xs text-foreground">첨부 이미지 {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachmentItem(sessionId, idx)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/75"
                    aria-label="첨부 이미지 삭제"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 아래쪽: 모델 + 설정 (펼침) */}
        <div className="relative px-4 pb-2 pt-1 [&_select]:min-h-0 [&_select]:h-9 [&_select]:py-1.5 [&_select]:min-w-[170px]">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <div className="inline-flex min-w-max items-center gap-3 pr-2">
                <button
                  type="button"
                  onClick={handlePlusClick}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/45 hover:text-foreground"
                  aria-label="첨부 메뉴"
                  title={showImageFeatures ? '이미지 첨부' : '이미지 모드로 전환'}
                >
                  {showImageFeatures && uploadingAttachments ? <span className="text-xs">…</span> : <Plus size={19} />}
                </button>
                {isChat && (
                  <div className="flex items-center gap-4 px-1">
                    <button
                      type="button"
                      onClick={() => setChatInputMode(currentSession.id, 'text')}
                      className={`text-sm transition-colors ${
                        getChatInputMode(currentSession.id) === 'text'
                          ? 'text-foreground font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      aria-label="텍스트 모드"
                    >
                      텍스트
                    </button>
                    <button
                      type="button"
                      onClick={() => setChatInputMode(currentSession.id, 'image')}
                      className={`text-sm transition-colors ${
                        getChatInputMode(currentSession.id) === 'image'
                          ? 'text-foreground font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      aria-label="이미지 모드"
                    >
                      이미지
                    </button>
                  </div>
                )}
                <ModelSelector
                  kind={isChat ? (getChatInputMode(currentSession.id) === 'image' ? 'image' : 'chat') : 'image'}
                  value={isChat ? (getChatInputMode(currentSession.id) === 'image' ? imageModel : chatModel) : imageModel}
                  onChange={isChat ? (getChatInputMode(currentSession.id) === 'image' ? handleImageModelChange : (m) => setChatModel(currentSession.id, m)) : handleImageModelChange}
                />
                {showImageFeatures && supportsReference && (
                  <button
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={uploadingRef || sending}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/45 hover:text-foreground disabled:opacity-50"
                    title={hasRefImage ? '참조 이미지 변경' : '참조 이미지 업로드'}
                    aria-label={hasRefImage ? '참조 이미지 변경' : '참조 이미지 업로드'}
                  >
                    {uploadingRef ? <span className="text-xs">…</span> : hasRefImage ? <ImagePlus size={16} /> : <Upload size={16} />}
                  </button>
                )}
                {showImageFeatures && modelGuide && (
                  <div ref={modelInfoRef}>
                    <button
                      type="button"
                      onClick={() => setModelInfoOpen((v) => !v)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/45 hover:text-foreground"
                      aria-label="모델 가능 작업 보기"
                      title="모델 가능 작업 보기"
                    >
                      <Info size={15} />
                    </button>
                  </div>
                )}
                {showImageFeatures && modelSettings && imageSettings && (
                  <button
                    type="button"
                    onClick={() => setImageSettingsOpen((v) => !v)}
                    className="flex items-center gap-1.5 px-1.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
                  >
                    <Settings2 size={16} />
                    설정
                    <ChevronDown
                      size={14}
                      className={`shrink-0 transition-transform duration-200 ease-out ${imageSettingsOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2 pb-0.5">
            {!sending && (
              <button
                type="button"
                onClick={handleMicClick}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/45 hover:text-foreground"
                aria-label="음성 입력"
              >
                <Mic size={18} />
              </button>
            )}
            {sending ? (
              <button
                type="button"
                onClick={stopGeneration}
                className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full border border-destructive/50 bg-destructive/20 text-destructive-foreground font-medium hover:bg-destructive/28 transition-colors duration-200"
                aria-label="중단"
              >
                <X size={20} />
              </button>
            ) : isRegenerateMode ? (
              <>
                <button
                  type="button"
                  onClick={() => { clearRegeneratePrompt(); setPrompt(''); }}
                  className="shrink-0 px-3 h-10 rounded-full border border-border/70 bg-secondary/48 text-muted-foreground font-medium hover:text-foreground hover:bg-secondary/75 transition-colors duration-200"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={!prompt.trim()}
                  className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full border border-foreground/80 bg-foreground text-background hover:bg-foreground/90 disabled:bg-secondary/42 disabled:text-muted-foreground disabled:border-border/60 disabled:opacity-100 disabled:cursor-not-allowed transition-colors duration-200"
                  aria-label="재질문"
                >
                  <ArrowUp size={20} />
                </button>
              </>
            ) : isRegenerateImageMode ? (
              <>
                <button
                  type="button"
                  onClick={() => { clearRegenerateImagePrompt(); setPrompt(''); }}
                  className="shrink-0 px-3 h-10 rounded-full border border-border/70 bg-secondary/48 text-muted-foreground font-medium hover:text-foreground hover:bg-secondary/75 transition-colors duration-200"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={!prompt.trim()}
                  className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full border border-foreground/80 bg-foreground text-background hover:bg-foreground/90 disabled:bg-secondary/42 disabled:text-muted-foreground disabled:border-border/60 disabled:opacity-100 disabled:cursor-not-allowed transition-colors duration-200"
                  aria-label="재생성"
                >
                  <ArrowUp size={20} />
                </button>
              </>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full border border-foreground/80 bg-foreground text-background hover:bg-foreground/90 disabled:bg-secondary/42 disabled:text-muted-foreground disabled:border-border/60 disabled:opacity-100 disabled:cursor-not-allowed transition-colors duration-200"
                aria-label={showImageFeatures ? '생성' : '전송'}
              >
                <ArrowUp size={20} />
              </button>
            )}
            </div>
          </div>

          {showImageFeatures && modelGuide && modelInfoOpen && (
            <div className="mt-2">
              <div className="rounded-lg border border-border/65 bg-secondary/45 backdrop-blur-sm p-3">
                <p className="text-sm font-semibold text-foreground">{modelGuide.modelName}</p>
                <div className="mt-2 space-y-2">
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground">가능한 작업</p>
                    <ul className="mt-1 space-y-1">
                      {modelGuide.capabilities.map((line) => (
                        <li key={`cap-${line}`} className="text-xs text-foreground">- {line}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground">제한/불가능</p>
                    <ul className="mt-1 space-y-1">
                      {modelGuide.limitations.map((line) => (
                        <li key={`limit-${line}`} className="text-xs text-muted-foreground">- {line}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
          {showImageFeatures && modelSettings && imageSettings && (
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                imageSettingsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 pl-0 pt-2">
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span>비율</span>
                  <select
                    value={imageSettings.aspect_ratio}
                    onChange={(e) => setImageSettings(currentSession.id, { aspect_ratio: e.target.value })}
                    className="bg-secondary/55 border border-border/70 rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {modelSettings.aspectRatios.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span>생성 수</span>
                  <select
                    value={imageSettings.num_images}
                    onChange={(e) => setImageSettings(currentSession.id, { num_images: Number(e.target.value) })}
                    className="bg-secondary/55 border border-border/70 rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {Array.from({ length: modelSettings.numImagesMax }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                {modelSettings.resolutions && modelSettings.resolutions.length > 0 && (
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span>해상도</span>
                    <select
                      value={imageSettings.resolution ?? ''}
                      onChange={(e) => setImageSettings(currentSession.id, { resolution: e.target.value || undefined })}
                      className="bg-secondary/55 border border-border/70 rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {modelSettings.resolutions.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                )}
                {modelSettings.outputFormats && modelSettings.outputFormats.length > 0 && (
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span>포맷</span>
                    <select
                      value={imageSettings.output_format ?? ''}
                      onChange={(e) => setImageSettings(currentSession.id, { output_format: e.target.value || undefined })}
                      className="bg-secondary/55 border border-border/70 rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {modelSettings.outputFormats.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                )}
                {modelSettings.supportsSeed && (
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span>Seed</span>
                    <input
                      type="number"
                      value={imageSettings.seed ?? ''}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setImageSettings(currentSession.id, { seed: v === '' ? undefined : Number(v) });
                      }}
                      placeholder="—"
                      className="w-20 bg-secondary/55 border border-border/70 rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </label>
                )}
                </div>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
