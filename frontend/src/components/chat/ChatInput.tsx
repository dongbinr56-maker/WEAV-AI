import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useChat } from '@/contexts/ChatContext';
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
    regeneratePrompt,
    clearRegeneratePrompt,
    regenerateChat,
    regenerateImagePrompt,
    clearRegenerateImagePrompt,
    regenerateImage,
  } = useChat();
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!currentSession) return null;

  const chatModel = getChatModel(currentSession.id);
  const imageModel = getImageModel(currentSession.id);
  const isChat = currentSession.kind === 'chat';
  const isRegenerateMode =
    isChat && regeneratePrompt != null && regeneratePrompt.sessionId === currentSession.id;
  const isRegenerateImageMode =
    !isChat && regenerateImagePrompt != null && regenerateImagePrompt.sessionId === currentSession.id;

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

  return (
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 border-t border-border transition-colors duration-200">
      {error && (
        <div className="max-w-3xl mx-auto mb-2 flex items-center justify-between rounded bg-destructive/50 text-destructive-foreground px-3 py-2 text-sm animate-fade-in-up">
          <span>{error}</span>
          <button type="button" onClick={clearError} className="hover:text-primary transition-colors duration-200">
            닫기
          </button>
        </div>
      )}
      <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex flex-col gap-2">
        <div className="flex gap-2 items-center">
          <ModelSelector
            kind={currentSession.kind}
            value={isChat ? chatModel : imageModel}
            onChange={isChat ? (m) => setChatModel(currentSession.id, m) : (m) => setImageModel(currentSession.id, m)}
          />
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
            className="flex-1 bg-input border border-input rounded px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors duration-200"
            disabled={sending}
          />
          {sending ? (
            <button
              type="button"
              onClick={stopGeneration}
              className="px-4 py-2 rounded bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 transition-colors duration-200"
            >
              중단
            </button>
          ) : isRegenerateMode ? (
            <>
              <button
                type="button"
                onClick={() => {
                  clearRegeneratePrompt();
                  setPrompt('');
                }}
                className="px-4 py-2 rounded bg-muted text-muted-foreground font-medium hover:bg-muted/80 transition-colors duration-200"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="px-4 py-2 rounded bg-primary text-primary-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors duration-200"
              >
                재질문
              </button>
            </>
          ) : isRegenerateImageMode ? (
            <>
              <button
                type="button"
                onClick={() => {
                  clearRegenerateImagePrompt();
                  setPrompt('');
                }}
                className="px-4 py-2 rounded bg-muted text-muted-foreground font-medium hover:bg-muted/80 transition-colors duration-200"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="px-4 py-2 rounded bg-primary text-primary-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors duration-200"
              >
                재생성
              </button>
            </>
          ) : (
            <button
              type="submit"
              disabled={!prompt.trim()}
              className="px-4 py-2 rounded bg-primary text-primary-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors duration-200"
            >
              {isChat ? '전송' : '생성'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
