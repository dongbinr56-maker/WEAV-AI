import React, { useEffect, useRef } from 'react';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-fade-in"
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl max-w-sm w-full p-5 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-foreground mb-2">
          {title}
        </h2>
        <p id="confirm-dialog-desc" className="text-sm text-muted-foreground mb-5">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded bg-muted text-muted-foreground hover:bg-muted/80 font-medium transition-colors duration-200"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded font-medium transition-colors duration-200 ${
              variant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
