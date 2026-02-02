import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Settings2, Upload, X, ArrowUp, ImagePlus } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useChat } from '@/contexts/ChatContext';
import { useLayout } from '@/contexts/LayoutContext';
import {
  IMAGE_MODEL_SETTINGS,
  CHAT_PROMPT_MAX_LENGTH,
  CHAT_PROMPT_MAX_LENGTH_BY_MODEL,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_PROMPT_MAX_LENGTH_BY_MODEL,
  imageModelSupportsReference,
  validateChatPrompt,
  validateImagePrompt,
} from '@/constants/models';
import { chatApi } from '@/services/api/chatApi';
import { useToast } from '@/contexts/ToastContext';
import { ModelSelector } from './ModelSelector';

export function ChatInput() {
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
    getImageModel,
    setImageModel,
    getImageSettings,
    setImageSettings,
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
  } = useChat();
  const { showToast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [uploadingRef, setUploadingRef] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!currentSession) return null;

  const chatModel = getChatModel(currentSession.id);
  const imageModel = getImageModel(currentSession.id);
  const isChat = currentSession.kind === 'chat';
  const isRegenerateMode =
    isChat && regeneratePrompt != null && regeneratePrompt.sessionId === currentSession.id;
  const isRegenerateImageMode =
    !isChat && regenerateImagePrompt != null && regenerateImagePrompt.sessionId === currentSession.id;
  const modelSettings = !isChat ? IMAGE_MODEL_SETTINGS[imageModel] : null;
  const imageSettings = !isChat ? getImageSettings(currentSession.id, imageModel) : null;

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || sending) return;

    if (isChat) {
      const result = validateChatPrompt(text, chatModel);
      if (!result.valid) {
        showToast(result.message);
        return;
      }
    } else {
      const result = validateImagePrompt(text, imageModel);
      if (!result.valid) {
        showToast(result.message);
        return;
      }
    }

    setPrompt('');
    if (isRegenerateMode && currentSession) {
      clearRegeneratePrompt();
      await regenerateChat(currentSession.id, { prompt: text, model: chatModel });
    } else if (isRegenerateImageMode && currentSession) {
      clearRegenerateImagePrompt();
      await regenerateImage(currentSession.id, { prompt: text });
    } else if (isChat) {
      await sendChatMessage(text, chatModel);
    } else {
      await sendImageRequest(text, imageModel);
    }
  };

  const handleUploadReference = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentSession || currentSession.kind !== 'image') return;
    if (!file.type.startsWith('image/')) {
      showToast('이미지 파일만 업로드할 수 있습니다 (JPEG, PNG, WebP)');
      return;
    }
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

  const supportsReference = !isChat && imageModelSupportsReference(imageModel);
  const hasRefImage = !isChat && (getReferenceImageId(currentSession.id) != null || getReferenceImageUrl(currentSession.id) != null);

  const promptMaxLen = isChat
    ? (CHAT_PROMPT_MAX_LENGTH_BY_MODEL[chatModel] ?? CHAT_PROMPT_MAX_LENGTH)
    : (IMAGE_PROMPT_MAX_LENGTH_BY_MODEL[imageModel] ?? IMAGE_PROMPT_MAX_LENGTH);
  const showCharCount = prompt.length > 0 && prompt.length >= promptMaxLen * 0.8;
  const isOverLimit = prompt.length > promptMaxLen;

  const { sidebarOpen } = useLayout();

  return (
      <div
        className={`fixed bottom-0 right-0 p-4 transition-[left] duration-300 ease-out ${
          sidebarOpen ? 'left-72' : 'left-0'
        }`}
      >
      {error && (
        <div className="max-w-3xl mx-auto mb-2 flex items-center justify-between rounded-lg bg-destructive/50 text-destructive-foreground px-3 py-2 text-sm animate-fade-in-up">
          <span>{error}</span>
          <button type="button" onClick={clearError} className="hover:text-primary transition-colors duration-200">
            닫기
          </button>
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="max-w-3xl mx-auto rounded-2xl border border-border bg-background shadow-sm overflow-hidden animate-fade-in-up"
      >
        {/* 위쪽: 미디어 버튼 + 입력 + 전송 */}
        <div className="flex items-center gap-2 p-3">
          {supportsReference && (
            <>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleUploadReference}
                disabled={uploadingRef || sending}
              />
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadingRef || sending}
                className={`shrink-0 flex items-center justify-center w-11 h-11 rounded-xl border transition-colors duration-200 disabled:opacity-50 ${
                  hasRefImage
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                title={hasRefImage ? '참조 이미지 사용 중' : '참조 이미지 업로드'}
                aria-label={hasRefImage ? '참조 이미지 사용 중' : '참조 이미지 업로드'}
              >
                {uploadingRef ? (
                  <span className="text-xs">…</span>
                ) : hasRefImage ? (
                  <ImagePlus size={20} />
                ) : (
                  <Upload size={20} />
                )}
              </button>
              {hasRefImage && (
                <button
                  type="button"
                  onClick={() => {
                    setReferenceImageUrl(currentSession.id, null);
                    setReferenceImageId(currentSession.id, null);
                  }}
                  className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="참조 해제"
                >
                  <X size={18} />
                </button>
              )}
            </>
          )}
          <div className="relative flex-1 flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                isRegenerateMode
                  ? '수정 후 Enter 또는 재질문 버튼으로 재생성'
                  : isRegenerateImageMode
                    ? '수정 후 Enter 또는 재생성 버튼으로 재생성'
                    : isChat
                      ? '메시지를 입력하세요...'
                      : '이미지 설명을 입력하세요...'
              }
              className="w-full min-h-[48px] py-2.5 pl-4 pr-12 text-base text-foreground placeholder-muted-foreground bg-muted/40 rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors duration-200"
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
          </div>
          {sending ? (
            <button
              type="button"
              onClick={stopGeneration}
              className="shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 transition-colors duration-200"
              aria-label="중단"
            >
              <X size={22} />
            </button>
          ) : isRegenerateMode ? (
            <>
              <button
                type="button"
                onClick={() => { clearRegeneratePrompt(); setPrompt(''); }}
                className="shrink-0 px-4 h-12 rounded-xl text-muted-foreground font-medium hover:text-foreground hover:bg-muted transition-colors duration-200"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors duration-200"
                aria-label="재질문"
              >
                <ArrowUp size={22} />
              </button>
            </>
          ) : isRegenerateImageMode ? (
            <>
              <button
                type="button"
                onClick={() => { clearRegenerateImagePrompt(); setPrompt(''); }}
                className="shrink-0 px-4 h-12 rounded-xl text-muted-foreground font-medium hover:text-foreground hover:bg-muted transition-colors duration-200"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors duration-200"
                aria-label="재생성"
              >
                <ArrowUp size={22} />
              </button>
            </>
          ) : (
            <button
              type="submit"
              disabled={!prompt.trim()}
              className="shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors duration-200"
              aria-label={isChat ? '전송' : '생성'}
            >
              <ArrowUp size={22} />
            </button>
          )}
        </div>

        {/* 아래쪽: 모델 + 설정 (펼침) */}
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-0 border-t border-border/50 [&_select]:min-h-0 [&_select]:h-9 [&_select]:py-1.5 [&_select]:min-w-[160px]">
          <ModelSelector
            kind={currentSession.kind}
            value={isChat ? chatModel : imageModel}
            onChange={isChat ? (m) => setChatModel(currentSession.id, m) : (m) => setImageModel(currentSession.id, m)}
          />
          {!isChat && modelSettings && imageSettings && (
            <>
              <button
                type="button"
                onClick={() => setImageSettingsOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-200"
              >
                <Settings2 size={16} />
                설정
                <ChevronDown
                  size={14}
                  className={`shrink-0 transition-transform duration-200 ease-out ${imageSettingsOpen ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className={`grid w-full transition-[grid-template-rows] duration-200 ease-out ${
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
                      className="bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                      className="bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                        className="bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                        className="bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                        className="w-20 bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </label>
                  )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
