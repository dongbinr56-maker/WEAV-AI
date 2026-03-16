import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, X, Download, Share2, ImagePlus, Check } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useChat } from '@/contexts/ChatContext';
import { useToast } from '@/contexts/ToastContext';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { DocumentPanel } from './DocumentPanel';
import { ImageModelGuidePanel } from './ImageModelGuidePanel';
import { ImagePromptBuilderPanel } from './ImagePromptBuilderPanel';
import { PromptOrchestratorPanel } from './PromptOrchestratorPanel';
import type { Citation, Message, ImageRecord } from '@/types';

type TimelineItem = { type: 'message'; data: Message } | { type: 'image'; data: ImageRecord };

const DOC_PANEL_WIDTH = 352;
const DOC_PANEL_MIN_WIDTH = 280;
const DOC_PANEL_MAX_WIDTH = 780;
const ORCHESTRATOR_PANEL_WIDTH = 360;
const ORCHESTRATOR_PANEL_MIN_WIDTH = 300;
const ORCHESTRATOR_PANEL_MAX_WIDTH = 760;
const GUIDE_PANEL_WIDTH = 340;
const GUIDE_PANEL_MIN_WIDTH = 280;
const GUIDE_PANEL_MAX_WIDTH = 520;
const IMAGE_PROMPT_PANEL_WIDTH = 380;
const IMAGE_PROMPT_PANEL_MIN_WIDTH = 320;
const IMAGE_PROMPT_PANEL_MAX_WIDTH = 760;

export function ChatView() {
  const { currentSession } = useApp();
  const {
    setRegeneratePrompt,
    setRegenerateImagePrompt,
    pendingImageRequest,
    sending,
    getChatInputMode,
    getImageModel,
    getReferenceImageId,
    setReferenceImageId,
    getDocuments,
    refreshDocuments,
    uploadDocument,
    deleteDocument,
  } = useChat();
  const { showToast } = useToast();
  const scrollRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [docPanelOpen, setDocPanelOpen] = useState(false);
  const [docPanelWidth, setDocPanelWidth] = useState(DOC_PANEL_WIDTH);
  const [activeDocId, setActiveDocId] = useState<number | null>(null);
  const [activeCitations, setActiveCitations] = useState<Citation[] | null>(null);
  const [activeCitationIndex, setActiveCitationIndex] = useState(0);
  const [inputAreaHeight, setInputAreaHeight] = useState(0);
  const [modelGuidePanelOpen, setModelGuidePanelOpen] = useState(false);
  const [modelGuidePanelWidth, setModelGuidePanelWidth] = useState(GUIDE_PANEL_WIDTH);
  const [imagePromptPanelOpen, setImagePromptPanelOpen] = useState(false);
  const [imagePromptPanelWidth, setImagePromptPanelWidth] = useState(IMAGE_PROMPT_PANEL_WIDTH);
  const [orchestratorPanelOpen, setOrchestratorPanelOpen] = useState(false);
  const [orchestratorPanelWidth, setOrchestratorPanelWidth] = useState(ORCHESTRATOR_PANEL_WIDTH);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);
  const messageCount = currentSession?.messages?.length ?? 0;
  const imageRecordCount = currentSession?.image_records?.length ?? 0;

  const updateNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    nearBottomRef.current = distance < 180;
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    nearBottomRef.current = true;
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  useEffect(() => {
    // Only auto-scroll when the user is already near the bottom.
    const el = scrollRef.current;
    if (!el) return;
    if (!nearBottomRef.current) return;
    requestAnimationFrame(() => {
      // Use endRef so padding/scroll-padding are respected.
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
  }, [messageCount, imageRecordCount, currentSession?.id, inputAreaHeight]);

  useEffect(() => {
    // When switching sessions, default to bottom.
    nearBottomRef.current = true;
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
  }, [currentSession?.id]);

  useEffect(() => {
    if (currentSession?.kind === 'chat') {
      refreshDocuments(currentSession.id).catch(() => {});
    } else {
      setDocPanelOpen(false);
      setOrchestratorPanelOpen(false);
      setImagePromptPanelOpen(false);
      setModelGuidePanelOpen(false);
    }
    setActiveCitations(null);
    setActiveCitationIndex(0);
  }, [currentSession?.id, currentSession?.kind, refreshDocuments]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    if (!currentSession || currentSession.kind !== 'chat') return;
    if (activeCitations && activeCitations.length > 0) return;
    const docs = getDocuments(currentSession.id);
    if (activeDocId == null && docs.length > 0) {
      setActiveDocId(docs[0].id);
      setDocPanelOpen(true);
      setOrchestratorPanelOpen(false);
    }
  }, [currentSession, getDocuments, activeDocId, activeCitations]);

  const sessionKind = currentSession?.kind ?? null;
  const isStudio = sessionKind === 'studio';
  const isChat = sessionKind === 'chat';
  const isImageMode = currentSession ? (isChat ? getChatInputMode(currentSession.id) === 'image' : true) : false;
  const showImageContent = isImageMode;
  const messages = currentSession?.messages ?? [];
  const responseCount = messages.filter((m) => m.role === 'assistant').length;
  const imageRecords = currentSession?.image_records ?? [];
  const referenceImageId = currentSession ? getReferenceImageId(currentSession.id) : null;
  const documents = isChat && currentSession ? getDocuments(currentSession.id) : [];
  const imageModel = showImageContent && currentSession ? getImageModel(currentSession.id) : null;

  useEffect(() => {
    if (!showImageContent) {
      setImagePromptPanelOpen(false);
      setModelGuidePanelOpen(false);
    }
  }, [showImageContent]);

  if (!currentSession) {
    return (
      <div className="weav-chat-bg flex-1 flex items-center justify-center text-muted-foreground animate-fade-in">
        <p className="px-4 py-2 rounded-xl border border-border/65 bg-card/40 backdrop-blur-sm">
          왼쪽 메뉴에서 새 채팅을 시작하세요.
        </p>
      </div>
    );
  }

  if (isStudio) {
    return null;
  }

  // 메시지와 이미지를 시간순으로 한 타임라인에 공존
  const timelineItems: TimelineItem[] = [
    ...messages.map((m) => ({ type: 'message' as const, data: m })),
    ...imageRecords.map((r) => ({ type: 'image' as const, data: r })),
  ].sort((a, b) => new Date(a.data.created_at).getTime() - new Date(b.data.created_at).getTime());
  const lastUserMessage = (() => {
    const userMsgs = messages.filter((m) => m.role === 'user');
    return userMsgs[userMsgs.length - 1] ?? null;
  })();

  const rightOffset = isChat && !showImageContent
    ? (isMobileViewport ? 0 : (docPanelOpen ? docPanelWidth : orchestratorPanelOpen ? orchestratorPanelWidth : 0))
    : (isMobileViewport ? 0 : (imagePromptPanelOpen ? imagePromptPanelWidth : modelGuidePanelOpen ? modelGuidePanelWidth : 0));
  const panelsOpen = docPanelOpen || orchestratorPanelOpen || modelGuidePanelOpen || imagePromptPanelOpen;
  // Keep the latest message fully visible above the fixed composer (blur overlay).
  const bottomPad = Math.max(440, inputAreaHeight + 260);

  const toggleDocPanel = () => {
    setDocPanelOpen((prev) => {
      const next = !prev;
      if (next) setOrchestratorPanelOpen(false);
      return next;
    });
  };

  const toggleOrchestratorPanel = () => {
    setOrchestratorPanelOpen((prev) => {
      const next = !prev;
      if (next) setDocPanelOpen(false);
      return next;
    });
  };

  const toggleImagePromptPanel = () => {
    setImagePromptPanelOpen((prev) => {
      const next = !prev;
      if (next) setModelGuidePanelOpen(false);
      return next;
    });
  };

  const toggleModelGuidePanel = () => {
    setModelGuidePanelOpen((prev) => {
      const next = !prev;
      if (next) setImagePromptPanelOpen(false);
      return next;
    });
  };

  const handleShowCitations = (citations: Citation[]) => {
    if (!citations || citations.length === 0) return;
    setActiveCitations(citations);
    setActiveCitationIndex(0);
    setActiveDocId(citations[0]?.document_id ?? null);
    setDocPanelOpen(true);
    setOrchestratorPanelOpen(false);
  };

  const handleSelectDocument = (docId: number) => {
    setActiveDocId(docId);
    setActiveCitations(null);
    setActiveCitationIndex(0);
    setDocPanelOpen(true);
    setOrchestratorPanelOpen(false);
  };

  const toUrlList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
  };

  const renderInputImagePreview = (referenceUrls: string[], attachmentUrls: string[]) => {
    const hasImages = referenceUrls.length > 0 || attachmentUrls.length > 0;
    if (!hasImages) return null;
    return (
      <div className="flex justify-end mb-2">
        <div className="max-w-[85%] rounded-lg border border-border/65 bg-muted/24 px-3 py-2">
          {referenceUrls.length > 0 && (
            <div className="mb-2 last:mb-0">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">참고 이미지</p>
              <div className="flex flex-wrap gap-2">
                {referenceUrls.map((url, idx) => (
                  <button
                    key={`ref-${idx}-${url}`}
                    type="button"
                    onClick={() => setSelectedImageUrl(url)}
                    className="w-14 h-14 rounded-md overflow-hidden border border-border bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
                    title="참고 이미지 크게 보기"
                    aria-label="참고 이미지 크게 보기"
                  >
                    <img src={url} alt={`reference-input-${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {attachmentUrls.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">첨부 이미지</p>
              <div className="flex flex-wrap gap-2">
                {attachmentUrls.map((url, idx) => (
                  <button
                    key={`attach-${idx}-${url}`}
                    type="button"
                    onClick={() => setSelectedImageUrl(url)}
                    className="w-14 h-14 rounded-md overflow-hidden border border-border bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
                    title="첨부 이미지 크게 보기"
                    aria-label="첨부 이미지 크게 보기"
                  >
                    <img src={url} alt={`attachment-input-${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="weav-chat-bg flex-1 flex flex-col w-full transition-[padding-right] duration-200 ease-out"
      style={{
        ...(rightOffset > 0 ? { paddingRight: rightOffset } : {}),
        ...(panelsOpen
          ? ({
              // Panels open: reduce background noise so chat stays readable.
              ['--weav-chat-bg-opacity' as any]: '0.24',
              ['--weav-chat-bg-brightness' as any]: '1.08',
            } as any)
          : ({} as any)),
      }}
    >
      <div className="flex-1 flex flex-col w-full max-w-3xl mx-auto">
        <main
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 pt-6 transition-opacity duration-200 ease-out [overflow-anchor:none]"
          style={{ paddingBottom: bottomPad, scrollPaddingBottom: bottomPad }}
          onScroll={updateNearBottom}
        >
        <div className="animate-fade-in min-h-0">
          {isChat && messages.length > 0 && responseCount < 10 && (
            <div className="mb-4 rounded-lg bg-muted/50 border border-border px-3 py-2 text-sm text-muted-foreground animate-fade-in-up">
              응답이 10회 미만입니다 (현재 {responseCount}회). 10회 이상 대화 시 일부 기능이 활성화됩니다.
            </div>
          )}
          {timelineItems.length === 0 && !(pendingImageRequest?.sessionId === currentSession.id) ? (
            <div className="text-center text-muted-foreground py-12 animate-fade-in-up">
              <p>메시지를 입력하거나 이미지 설명을 입력해 생성하세요.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {timelineItems.map((item) => {
                if (item.type === 'message') {
                  return (
                    <ChatMessage
                      key={`msg-${item.data.id}`}
                      message={item.data}
                      isLastUserMessage={lastUserMessage != null && item.data.id === lastUserMessage.id && item.data.role === 'user'}
                      onShowCitations={handleShowCitations}
                      documents={documents}
                      onSelectDocument={handleSelectDocument}
                      onEditRequested={
                        lastUserMessage != null && item.data.id === lastUserMessage.id && currentSession
                          ? (prompt) => setRegeneratePrompt(currentSession.id, prompt)
                          : undefined
                      }
                    />
                  );
                }

                const referenceInputUrls = toUrlList(item.data.metadata?.input_reference_urls);
                const attachmentInputUrls = toUrlList(item.data.metadata?.input_attachment_urls);

                return (
                  <div
                    key={`img-${item.data.id}`}
                    className={`animate-fade-in-up group/image rounded-lg overflow-hidden ${referenceImageId === item.data.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                  >
                    {renderInputImagePreview(referenceInputUrls, attachmentInputUrls)}
                    <div className="flex justify-end mb-2 items-start gap-2">
                      <div className="max-w-[85%]">
                        <div className="weav-glass-bubble rounded-xl px-4 py-2 border text-foreground border-primary/40 transition-colors duration-200">
                          <p className="whitespace-pre-wrap text-sm">{item.data.prompt}</p>
                        </div>
                      </div>
                      {currentSession && (
                        <button
                          type="button"
                          onClick={() => setRegenerateImagePrompt(currentSession.id, item.data.prompt)}
                          disabled={sending}
                          className="p-1.5 rounded shrink-0 mt-1 bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border disabled:opacity-50 transition-colors duration-200"
                          title="하단 입력창에서 수정 후 재생성"
                          aria-label="하단 입력창에서 수정 후 재생성"
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                    </div>
                    <div className="flex justify-start">
                      <div className="max-w-[85%] relative group/img">
                        <button
                          type="button"
                          onClick={() => setSelectedImageUrl(item.data.image_url)}
                          className="rounded-lg overflow-hidden bg-secondary/60 border border-border/65 block w-full text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background min-h-[200px]"
                        >
                          <img
                            src={item.data.image_url}
                            alt={item.data.prompt}
                            className="w-full h-auto object-cover max-h-[480px] cursor-pointer min-h-[200px]"
                          />
                        </button>
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity duration-200 pointer-events-none group-hover/img:pointer-events-auto">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReferenceImageId(currentSession.id, referenceImageId === item.data.id ? null : item.data.id);
                            }}
                            className={`p-1.5 rounded border transition-colors duration-200 ${
                              referenceImageId === item.data.id
                                ? 'bg-primary/30 border-primary/45 text-foreground'
                                : 'bg-card/80 border-border/65 text-foreground hover:bg-card'
                            }`}
                            title={referenceImageId === item.data.id ? '참조 해제' : '참조로 사용 (구도·스타일 유지)'}
                            aria-label={referenceImageId === item.data.id ? '참조 해제' : '참조로 사용'}
                          >
                            {referenceImageId === item.data.id ? <Check size={14} /> : <ImagePlus size={14} />}
                          </button>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch(item.data.image_url, { mode: 'cors' });
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `weav-image-${item.data.id}.png`;
                                a.click();
                                URL.revokeObjectURL(url);
                              } catch {
                                const a = document.createElement('a');
                                a.href = item.data.image_url;
                                a.download = `weav-image-${item.data.id}.png`;
                                a.target = '_blank';
                                a.rel = 'noopener noreferrer';
                                a.click();
                              }
                            }}
                            className="p-1.5 rounded border border-border/65 bg-card/80 text-foreground hover:bg-card transition-colors duration-200"
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
                                  await navigator.share({ title: item.data.prompt.slice(0, 50), url: item.data.image_url });
                                } catch {
                                  await navigator.clipboard.writeText(item.data.image_url);
                                  showToast('복사되었습니다');
                                }
                              } else {
                                await navigator.clipboard.writeText(item.data.image_url);
                                showToast('복사되었습니다');
                              }
                            }}
                            className="p-1.5 rounded border border-border/65 bg-card/80 text-foreground hover:bg-card transition-colors duration-200"
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
                  {renderInputImagePreview(pendingImageRequest.referenceImageUrls, pendingImageRequest.attachmentImageUrls)}
                  <div className="flex justify-end mb-2">
                    <div className="max-w-[85%]">
                      <div className="rounded-xl px-4 py-2 border bg-primary/18 text-foreground border-primary/40 transition-colors duration-200">
                        <p className="whitespace-pre-wrap text-sm">{pendingImageRequest.prompt}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[85%]">
                      <div className="rounded-xl overflow-hidden bg-secondary/58 border border-border/65 backdrop-blur-sm flex items-center justify-center min-h-[200px] w-[280px] text-muted-foreground text-sm">
                        이미지 생성 중...
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div ref={endRef} className="h-px" />
        </main>
      </div>
      <ChatInput
        rightOffset={rightOffset}
        onHeightChange={setInputAreaHeight}
        onSubmitStart={() => scrollToLatest('smooth')}
      />
      {isMobileViewport && panelsOpen && (
        <button
          type="button"
          aria-label="열린 패널 닫기"
          onClick={() => {
            setDocPanelOpen(false);
            setOrchestratorPanelOpen(false);
            setImagePromptPanelOpen(false);
            setModelGuidePanelOpen(false);
          }}
          className="fixed inset-0 top-14 z-10 bg-background/55 backdrop-blur-[2px] lg:hidden"
        />
      )}
      {isChat && !showImageContent && currentSession && (
        <DocumentPanel
          open={docPanelOpen}
          onToggle={toggleDocPanel}
          showTrigger={!orchestratorPanelOpen}
          triggerTopClassName="top-28"
          panelWidth={docPanelWidth}
          minWidth={DOC_PANEL_MIN_WIDTH}
          maxWidth={DOC_PANEL_MAX_WIDTH}
          onResize={setDocPanelWidth}
          documents={documents}
          onRefresh={() => {
            refreshDocuments(currentSession.id).catch(() => {});
          }}
          onUpload={(file) => {
            uploadDocument(currentSession.id, file).catch(() => {});
            setDocPanelOpen(true);
            setOrchestratorPanelOpen(false);
          }}
          onDelete={(docId) => {
            deleteDocument(currentSession.id, docId).catch(() => {});
            if (activeDocId === docId) {
              setActiveDocId(null);
            }
            setActiveCitations(null);
          }}
          activeDocId={activeDocId}
          onSelectDocument={(docId) => setActiveDocId(docId)}
          citations={activeCitations}
          activeCitationIndex={activeCitationIndex}
          onSelectCitation={(idx) => {
            setActiveCitationIndex(idx);
            const cite = activeCitations?.[idx];
            if (cite?.document_id) setActiveDocId(cite.document_id);
          }}
          onClearCitations={() => setActiveCitations(null)}
        />
      )}
      {isChat && !showImageContent && (
        <PromptOrchestratorPanel
          open={orchestratorPanelOpen}
          onToggle={toggleOrchestratorPanel}
          showTrigger={!docPanelOpen}
          triggerTopClassName="top-40"
          panelWidth={orchestratorPanelWidth}
          minWidth={ORCHESTRATOR_PANEL_MIN_WIDTH}
          maxWidth={ORCHESTRATOR_PANEL_MAX_WIDTH}
          onResize={setOrchestratorPanelWidth}
        />
      )}
      {showImageContent && currentSession && imageModel && (
        <ImagePromptBuilderPanel
          open={imagePromptPanelOpen}
          onToggle={toggleImagePromptPanel}
          showTrigger={!modelGuidePanelOpen}
          triggerTopClassName="top-40"
          panelWidth={imagePromptPanelWidth}
          minWidth={IMAGE_PROMPT_PANEL_MIN_WIDTH}
          maxWidth={IMAGE_PROMPT_PANEL_MAX_WIDTH}
          onResize={setImagePromptPanelWidth}
          modelId={imageModel}
          onApplyPrompt={(prompt) => {
            setRegenerateImagePrompt(currentSession.id, prompt);
            showToast('프롬프트를 입력창에 넣었습니다.');
          }}
        />
      )}
      {showImageContent && imageModel && (
        <ImageModelGuidePanel
          open={modelGuidePanelOpen}
          onToggle={toggleModelGuidePanel}
          showTrigger={!imagePromptPanelOpen}
          triggerTopClassName="top-28"
          panelWidth={modelGuidePanelWidth}
          minWidth={GUIDE_PANEL_MIN_WIDTH}
          maxWidth={GUIDE_PANEL_MAX_WIDTH}
          onResize={setModelGuidePanelWidth}
          modelId={imageModel}
        />
      )}
      {/* 이미지 크게 보기 모달 */}
      {selectedImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/82 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setSelectedImageUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="이미지 크게 보기"
        >
          <button
            type="button"
            onClick={() => setSelectedImageUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full border border-border/65 bg-card/85 text-foreground hover:bg-card transition-colors duration-200"
            aria-label="닫기"
          >
            <X size={24} />
          </button>
          <img
            src={selectedImageUrl}
            alt="크게 보기"
            className="max-w-full max-h-[90vh] w-auto h-auto object-contain rounded-lg border border-border/60 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
