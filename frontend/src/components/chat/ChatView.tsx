import { useEffect, useRef, useState } from 'react';
import { Pencil, X, Download, Share2, ImagePlus, Check } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useChat } from '@/contexts/ChatContext';
import { useToast } from '@/contexts/ToastContext';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';

export function ChatView() {
  const { currentSession } = useApp();
  const { setRegeneratePrompt, setRegenerateImagePrompt, pendingImageRequest, sending, getReferenceImageId, setReferenceImageId } = useChat();
  const { showToast } = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  const messageCount = currentSession?.messages?.length ?? 0;
  const imageRecordCount = currentSession?.image_records?.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messageCount, imageRecordCount]);

  if (!currentSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground animate-fade-in">
        <p>왼쪽 메뉴에서 새 채팅 또는 새 이미지를 시작하세요.</p>
      </div>
    );
  }

  const isChat = currentSession.kind === 'chat';
  const messages = currentSession.messages ?? [];
  const responseCount = messages.filter((m) => m.role === 'assistant').length;
  const imageRecords = currentSession.image_records ?? [];
  const referenceImageId = getReferenceImageId(currentSession.id);

  return (
    <div className="flex-1 flex flex-col w-full max-w-3xl mx-auto animate-fade-in">
      <main className="flex-1 overflow-y-auto px-4 pt-6 pb-40">
        {isChat ? (
          messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 animate-fade-in-up">
              <p>메시지를 입력하고 전송하세요.</p>
            </div>
          ) : (
            <>
              {responseCount < 10 && (
                <div className="mb-4 rounded-lg bg-muted/50 border border-border px-3 py-2 text-sm text-muted-foreground animate-fade-in-up">
                  응답이 10회 미만입니다 (현재 {responseCount}회). 10회 이상 대화 시 일부 기능이 활성화됩니다.
                </div>
              )}
              {messages.map((msg) => {
              const lastUserMsg =
                messages.length >= 2 && messages[messages.length - 1].role === 'assistant'
                  ? messages[messages.length - 2]
                  : null;
              const isLastUserMessage =
                msg.role === 'user' && lastUserMsg != null && msg.id === lastUserMsg.id;
              return (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  isLastUserMessage={isLastUserMessage}
                  onEditRequested={
                    isLastUserMessage && currentSession
                      ? (prompt) => setRegeneratePrompt(currentSession.id, prompt)
                      : undefined
                  }
                />
              );
            })}
            </>
          )
        ) : (
          <>
            {imageRecords.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 animate-fade-in-up">
                <p>이미지 설명을 입력하고 생성하세요.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* API는 최신순(-created_at)으로 오므로, 표시만 오래된순(맨 아래가 최신)으로 역순 처리 */}
                {[...imageRecords].reverse().map((rec, index) => {
                  const isLastImage = index === imageRecords.length - 1;
                  return (
                    <div
                      key={rec.id}
                      className={`animate-fade-in-up group/image rounded-lg overflow-hidden ${referenceImageId === rec.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                      style={{ animationDelay: `${index * 80}ms` }}
                    >
                      {/* 질문: 유저 풍선 (오른쪽) + 재생성 버튼 */}
                      <div className="flex justify-end mb-2 items-start gap-2">
                        <div className="max-w-[85%]">
                          <div className="rounded-lg px-4 py-2 bg-primary text-primary-foreground transition-colors duration-200">
                            <p className="whitespace-pre-wrap text-sm">{rec.prompt}</p>
                          </div>
                        </div>
                        {isLastImage && currentSession && (
                          <button
                            type="button"
                            onClick={() => setRegenerateImagePrompt(currentSession.id, rec.prompt)}
                            disabled={sending}
                            className="p-1.5 rounded shrink-0 mt-1 bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground border border-border disabled:opacity-50 transition-colors duration-200"
                            title="하단 입력창에서 수정 후 재생성"
                            aria-label="하단 입력창에서 수정 후 재생성"
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                      </div>
                      {/* 답변: 이미지 (왼쪽) — 클릭 시 크게 보기, hover 시 다운로드/공유 */}
                      <div className="flex justify-start">
                        <div className="max-w-[85%] relative group/img">
                          <button
                            type="button"
                            onClick={() => setSelectedImageUrl(rec.image_url)}
                            className="rounded-lg overflow-hidden bg-secondary border border-border block w-full text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background min-h-[200px]"
                          >
                            <img
                              src={rec.image_url}
                              alt={rec.prompt}
                              className="w-full h-auto object-cover max-h-[480px] cursor-pointer min-h-[200px]"
                            />
                          </button>
                          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity duration-200 pointer-events-none group-hover/img:pointer-events-auto">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReferenceImageId(currentSession.id, referenceImageId === rec.id ? null : rec.id);
                              }}
                              className={`p-1.5 rounded transition-colors duration-200 ${
                                referenceImageId === rec.id
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-black/60 text-white hover:bg-black/80'
                              }`}
                              title={referenceImageId === rec.id ? '참조 해제' : '참조로 사용 (구도·스타일 유지)'}
                              aria-label={referenceImageId === rec.id ? '참조 해제' : '참조로 사용'}
                            >
                              {referenceImageId === rec.id ? <Check size={14} /> : <ImagePlus size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const res = await fetch(rec.image_url, { mode: 'cors' });
                                  const blob = await res.blob();
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `weav-image-${rec.id}.png`;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                } catch {
                                  const a = document.createElement('a');
                                  a.href = rec.image_url;
                                  a.download = `weav-image-${rec.id}.png`;
                                  a.target = '_blank';
                                  a.rel = 'noopener noreferrer';
                                  a.click();
                                }
                              }}
                              className="p-1.5 rounded bg-black/60 text-white hover:bg-black/80 transition-colors duration-200"
                              title="다운로드"
                              aria-label="다운로드"
                            >
                              <Download size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (navigator.share) {
                                  try {
                                    await navigator.share({
                                      title: rec.prompt.slice(0, 50),
                                      url: rec.image_url,
                                    });
                                  } catch {
                                    await navigator.clipboard.writeText(rec.image_url);
                                    showToast('복사되었습니다');
                                  }
                                } else {
                                  await navigator.clipboard.writeText(rec.image_url);
                                  showToast('복사되었습니다');
                                }
                              }}
                              className="p-1.5 rounded bg-black/60 text-white hover:bg-black/80 transition-colors duration-200"
                              title="공유"
                              aria-label="공유"
                            >
                              <Share2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {pendingImageRequest?.sessionId === currentSession.id && (
                  <div className="animate-fade-in-up">
                    {/* 질문 먼저: 유저 풍선 (오른쪽) */}
                    <div className="flex justify-end mb-2">
                      <div className="max-w-[85%]">
                        <div className="rounded-lg px-4 py-2 bg-primary text-primary-foreground transition-colors duration-200">
                          <p className="whitespace-pre-wrap text-sm">{pendingImageRequest.prompt}</p>
                        </div>
                      </div>
                    </div>
                    {/* 답변 로딩 중 */}
                    <div className="flex justify-start">
                      <div className="max-w-[85%]">
                        <div className="rounded-lg overflow-hidden bg-secondary border border-border flex items-center justify-center min-h-[200px] w-[280px] text-muted-foreground text-sm">
                          이미지 생성 중...
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </main>
      <ChatInput />
      {/* 이미지 크게 보기 모달 */}
      {selectedImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fade-in"
          onClick={() => setSelectedImageUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="이미지 크게 보기"
        >
          <button
            type="button"
            onClick={() => setSelectedImageUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors duration-200"
            aria-label="닫기"
          >
            <X size={24} />
          </button>
          <img
            src={selectedImageUrl}
            alt="크게 보기"
            className="max-w-full max-h-[90vh] w-auto h-auto object-contain rounded-lg shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
