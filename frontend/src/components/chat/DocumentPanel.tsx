import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Upload, FileText, Trash2 } from 'lucide-react';
import type { Citation, DocumentItem } from '@/types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

type PdfPageProps = {
  url: string;
  pageNumber: number;
  onPageCount?: (count: number) => void;
  highlight?: Citation | null;
};

function PdfPage({ url, pageNumber, onPageCount, highlight }: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const loadTaskRef = useRef<any>(null);
  const renderSeqRef = useRef(0);
  const renderRetryRef = useRef(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [pdfVersion, setPdfVersion] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? 0;
      setContainerWidth(width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!url) return;
    setLoadError(null);
    setLoading(true);
    renderRetryRef.current = 0;
    const task = pdfjsLib.getDocument(url);
    loadTaskRef.current = task;
    task.promise
      .then((pdf: any) => {
        if (cancelled) return;
        pdfRef.current = pdf;
        onPageCount?.(pdf.numPages);
        setLoadError(null);
        setPdfVersion((v) => v + 1);
      })
      .catch((err) => {
        if (cancelled) return;
        pdfRef.current = null;
        setLoadError('PDF 로딩에 실패했습니다. URL 또는 권한을 확인하세요.');
        // eslint-disable-next-line no-console
        console.error('PDF load failed', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (loadTaskRef.current?.destroy) {
        loadTaskRef.current.destroy().catch?.(() => {});
      }
      if (renderTaskRef.current?.cancel) {
        renderTaskRef.current.cancel();
      }
      if (pdfRef.current?.destroy) {
        pdfRef.current.destroy().catch?.(() => {});
      }
      pdfRef.current = null;
    };
  }, [url, onPageCount, retryKey]);

  useEffect(() => {
    let cancelled = false;
    const renderSeq = (renderSeqRef.current += 1);
    async function render() {
      if (!pdfRef.current || !canvasRef.current || !containerWidth) return;
      const pdf = pdfRef.current;
      const clampedPage = Math.max(1, Math.min(pageNumber, pdf.numPages));
      const page = await pdf.getPage(clampedPage);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = containerWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      setViewportSize({ width: viewport.width, height: viewport.height });
      if (renderTaskRef.current?.cancel) {
        renderTaskRef.current.cancel();
      }
      const renderTask = page.render({ canvasContext: context, viewport });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      if (cancelled || renderSeq !== renderSeqRef.current) return;
      renderRetryRef.current = 0;
      setLoadError(null);
    }
    render().catch((err) => {
      if (cancelled || renderSeq !== renderSeqRef.current) return;
      const msg = String(err?.message || err);
      if (err?.name === 'RenderingCancelledException' || msg.includes('Rendering cancelled')) {
        return;
      }
      if (renderRetryRef.current < 1) {
        renderRetryRef.current += 1;
        requestAnimationFrame(() => setPdfVersion((v) => v + 1));
        return;
      }
      setLoadError('PDF 렌더링에 실패했습니다. 다시 시도하세요.');
      // eslint-disable-next-line no-console
      console.error('PDF render failed', err);
    });
    return () => {
      cancelled = true;
      if (renderTaskRef.current?.cancel) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pageNumber, containerWidth, url, pdfVersion]);

  const highlightStyle = useMemo(() => {
    if (!highlight || !viewportSize) return null;
    let norm = highlight.bbox_norm;
    if (!norm && highlight.bbox && highlight.page_width && highlight.page_height) {
      const [x0, y0, x1, y1] = highlight.bbox;
      norm = [x0 / highlight.page_width, y0 / highlight.page_height, x1 / highlight.page_width, y1 / highlight.page_height];
    }
    if (!norm) return null;
    const [x0, y0, x1, y1] = norm;
    const left = Math.max(0, Math.min(1, x0)) * viewportSize.width;
    const top = Math.max(0, Math.min(1, y0)) * viewportSize.height;
    const width = Math.max(0, Math.min(1, x1) - Math.max(0, Math.min(1, x0))) * viewportSize.width;
    const height = Math.max(0, Math.min(1, y1) - Math.max(0, Math.min(1, y0))) * viewportSize.height;
    return { left, top, width, height };
  }, [highlight, viewportSize]);

  return (
    <div ref={containerRef} className="relative w-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          PDF 로딩 중...
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/80 text-xs text-muted-foreground">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setRetryKey((v) => v + 1)}
            className="rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            다시 시도
          </button>
        </div>
      )}
      <canvas ref={canvasRef} className="w-full rounded-lg border border-border bg-white" />
      {highlightStyle && (
        <div
          className="absolute border-2 border-primary bg-primary/20 pointer-events-none"
          style={{
            left: highlightStyle.left,
            top: highlightStyle.top,
            width: highlightStyle.width,
            height: highlightStyle.height,
          }}
        />
      )}
    </div>
  );
}

type DocumentPanelProps = {
  open: boolean;
  onToggle: () => void;
  showTrigger?: boolean;
  triggerTopClassName?: string;
  panelWidth: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
  documents: DocumentItem[];
  onRefresh: () => void;
  onUpload: (file: File) => void;
  onDelete: (docId: number) => void;
  activeDocId: number | null;
  onSelectDocument: (docId: number | null) => void;
  citations: Citation[] | null;
  activeCitationIndex: number;
  onSelectCitation: (index: number) => void;
  onClearCitations: () => void;
};

export function DocumentPanel({
  open,
  onToggle,
  showTrigger = true,
  triggerTopClassName = 'top-28',
  panelWidth,
  minWidth,
  maxWidth,
  onResize,
  documents,
  onRefresh,
  onUpload,
  onDelete,
  activeDocId,
  onSelectDocument,
  citations,
  activeCitationIndex,
  onSelectCitation,
  onClearCitations,
}: DocumentPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [resizing, setResizing] = useState(false);
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<DocumentItem | null>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

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

  const getDocumentStatusText = (doc: DocumentItem) => {
    if (doc.status === 'completed') return '완료';
    if (doc.status === 'failed') return '실패';
    if (doc.status === 'pending') return '대기 중';
    return '처리 중';
  };

  const getDocumentProgressText = (doc: DocumentItem) => {
    if (doc.status !== 'processing') return '';
    if (doc.progress_label?.trim()) return doc.progress_label.trim();
    if ((doc.total_pages ?? 0) > 0) {
      return `${Math.min(doc.processed_pages ?? 0, doc.total_pages ?? 0)} / ${doc.total_pages} 페이지 처리 중`;
    }
    return '문서 처리 중';
  };

  const getDocumentProgressPercent = (doc: DocumentItem) => {
    if (doc.status === 'completed') return 100;
    if (doc.status !== 'processing') return 0;
    const total = doc.total_pages ?? 0;
    if (total <= 0) return 0;
    const processed = Math.min(doc.processed_pages ?? 0, total);
    return Math.max(0, Math.min(100, (processed / total) * 100));
  };

  const activeCitation = citations && citations.length > 0 ? citations[activeCitationIndex] : null;
  const activeDoc = documents.find((doc) => doc.id === (activeCitation?.document_id ?? activeDocId));
  const docUrl = activeDoc?.file_url ?? '';

  useEffect(() => {
    if (activeCitation?.page) {
      setPageNumber(activeCitation.page);
      return;
    }
    setPageNumber(1);
  }, [activeCitation?.page, activeDoc?.id]);

  useEffect(() => {
    setPageCount(0);
  }, [activeDoc?.id]);

  useEffect(() => {
    if (pageCount > 0 && pageNumber > pageCount) {
      setPageNumber(pageCount);
    }
  }, [pageCount, pageNumber]);

  useEffect(() => {
    if (!open) return;
    const hasPending = documents.some((d) => d.status === 'pending' || d.status === 'processing');
    if (!hasPending) return;
    const id = setInterval(() => onRefresh(), 1000);
    return () => clearInterval(id);
  }, [documents, onRefresh, open]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onUpload(file);
  };

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e: MouseEvent) => {
      if (!resizeStart.current) return;
      const delta = resizeStart.current.x - e.clientX;
      const next = Math.min(maxWidth, Math.max(minWidth, resizeStart.current.width + delta));
      onResize(next);
    };
    const handleUp = () => {
      setResizing(false);
      resizeStart.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizing, minWidth, maxWidth, onResize]);

  return (
    <>
      <ConfirmDialog
        open={pendingDeleteDoc != null}
        title="문서 삭제"
        message={pendingDeleteDoc ? `'${pendingDeleteDoc.original_name}' 문서를 삭제할까요?` : ''}
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="destructive"
        onConfirm={() => {
          if (pendingDeleteDoc) onDelete(pendingDeleteDoc.id);
          setPendingDeleteDoc(null);
        }}
        onCancel={() => setPendingDeleteDoc(null)}
      />
      {!open && showTrigger && (
        <button
          type="button"
          onClick={onToggle}
          className={`fixed right-0 ${triggerTopClassName} z-20 rounded-l-xl border border-border/65 bg-card/86 backdrop-blur-xl px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground`}
        >
          문서
        </button>
      )}
      <aside
        className={`chat-slide-panel fixed top-14 right-0 z-20 h-[calc(100vh-3.5rem)] w-full border-l border-border/65 bg-card/86 backdrop-blur-xl transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: panelWidth }}
      >
        {open && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setResizing(true);
              resizeStart.current = { x: e.clientX, width: panelWidth };
            }}
            className="chat-slide-panel__resizer absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/25"
            title="드래그하여 크기 조절"
          />
        )}
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText size={16} />
              문서 패널
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.hwp,.hwpx,application/pdf,application/x-hwp,application/vnd.hancom.hwp,application/vnd.hancom.hwpx"
                className="hidden"
                onChange={handleUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/55 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Upload size={14} />
                업로드
              </button>
              <button
                type="button"
                onClick={onToggle}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label="닫기"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground">문서 목록</h3>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  새로고침
                </button>
              </div>
              {documents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  업로드된 문서가 없습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => {
                    const isActive = activeDoc?.id === doc.id;
                    return (
                      <div
                        key={doc.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          onSelectDocument(doc.id);
                          onClearCitations();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectDocument(doc.id);
                            onClearCitations();
                          }
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                          isActive ? 'border-primary/45 bg-primary/12 text-foreground' : 'border-border/70 bg-background/70 text-muted-foreground hover:bg-muted/35'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground truncate">{doc.original_name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              {getDocumentStatusText(doc)}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDeleteDoc(doc);
                              }}
                              className="rounded p-1 text-muted-foreground hover:text-rose-500"
                              aria-label="문서 삭제"
                              title="삭제"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {formatDocTime(doc.created_at)}
                        </div>
                        {getDocumentProgressText(doc) && (
                          <p className="mt-1 text-[10px] text-muted-foreground">{getDocumentProgressText(doc)}</p>
                        )}
                        {doc.status === 'processing' && (
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                              style={{ width: `${getDocumentProgressPercent(doc)}%` }}
                            />
                          </div>
                        )}
                        {doc.error_message && doc.status === 'failed' && (
                          <p className="mt-1 text-[10px] text-rose-500">{doc.error_message}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {citations && citations.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-muted-foreground">답변 근거</h3>
                  <button
                    type="button"
                    onClick={onClearCitations}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    닫기
                  </button>
                </div>
                <div className="space-y-2">
                  {citations.map((cite, idx) => (
                    <button
                      key={`${cite.document_id}-${idx}`}
                      type="button"
                      onClick={() => onSelectCitation(idx)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-[11px] transition-colors ${
                        idx === activeCitationIndex
                          ? 'border-primary/45 bg-primary/12 text-foreground'
                          : 'border-border/70 bg-background/70 text-muted-foreground hover:bg-muted/35'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground truncate">{cite.document_name}</span>
                        <span className="text-[10px] text-muted-foreground">p.{cite.page}</span>
                      </div>
                      {cite.snippet && (
                        <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{cite.snippet}</p>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground">문서 보기</h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPageNumber((prev) => Math.max(1, prev - 1))}
                    disabled={pageNumber <= 1}
                    className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-[11px] text-muted-foreground">
                    {pageCount > 0 ? `${pageNumber} / ${pageCount}` : `${pageNumber}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPageNumber((prev) => Math.min(pageCount || prev + 1, prev + 1))}
                    disabled={pageCount > 0 && pageNumber >= pageCount}
                    className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              {activeDoc ? (
                activeDoc.status === 'completed' ? (
                  <PdfPage
                    key={activeDoc.id}
                    url={docUrl}
                    pageNumber={pageNumber}
                    onPageCount={setPageCount}
                    highlight={activeCitation}
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    {getDocumentProgressText(activeDoc) || '문서 처리 중입니다.'} 완료되면 미리보기가 표시됩니다.
                  </div>
                )
              ) : (
                <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  문서를 선택하면 이곳에 표시됩니다.
                </div>
              )}
            </section>
          </div>
        </div>
      </aside>
    </>
  );
}
