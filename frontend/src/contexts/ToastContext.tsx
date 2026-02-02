import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

type ToastContextValue = {
  showToast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION = 2500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setMessage(msg);
  }, []);

  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), TOAST_DURATION);
    return () => window.clearTimeout(id);
  }, [message]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium shadow-lg animate-fade-in"
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
