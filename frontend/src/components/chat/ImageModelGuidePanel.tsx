import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Info } from 'lucide-react';
import { getImageModelGuide } from './imageModelGuide';

type ImageModelGuidePanelProps = {
  open: boolean;
  onToggle: () => void;
  showTrigger?: boolean;
  triggerTopClassName?: string;
  panelWidth: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
  modelId: string;
};

export function ImageModelGuidePanel({
  open,
  onToggle,
  showTrigger = true,
  triggerTopClassName = 'top-28',
  panelWidth,
  minWidth,
  maxWidth,
  onResize,
  modelId,
}: ImageModelGuidePanelProps) {
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const guide = useMemo(() => getImageModelGuide(modelId), [modelId]);

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
      {!open && showTrigger && (
        <button
          type="button"
          onClick={onToggle}
          className={`fixed right-0 ${triggerTopClassName} z-20 rounded-l-xl border border-border/65 bg-card/86 backdrop-blur-xl px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground`}
        >
          모델 가이드
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
              <Info size={16} />
              모델 가이드
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label="닫기"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            <section className="rounded-lg border border-border/70 bg-secondary/45 px-3 py-2">
              <h3 className="text-sm font-semibold text-foreground">{guide.modelName}</h3>
              <p className="mt-1 text-xs text-muted-foreground">현재 선택 모델의 가능/제약 정보를 확인하세요.</p>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">가능한 작업</h4>
              <ul className="space-y-1">
                {guide.capabilities.map((line) => (
                  <li key={line} className="rounded-md border border-border/70 bg-secondary/55 px-2.5 py-2 text-xs text-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">제한/불가능</h4>
              <ul className="space-y-1">
                {guide.limitations.map((line) => (
                  <li key={line} className="rounded-md border border-border/70 bg-secondary/55 px-2.5 py-2 text-xs text-muted-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">추천 사용법</h4>
              <ul className="space-y-1">
                {guide.tips.map((line) => (
                  <li key={line} className="rounded-md border border-border/70 bg-background/70 px-2.5 py-2 text-xs text-muted-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </aside>
    </>
  );
}
