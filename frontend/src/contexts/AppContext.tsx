import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { sessionApi } from '@/services/api/sessionApi';
import type { Session } from '@/types';

type AppContextValue = {
  sessions: Session[];
  currentSession: Session | null;
  loading: boolean;
  loadSessions: () => Promise<void>;
  selectSession: (session: Session | null) => Promise<void>;
  createSession: (kind: 'chat' | 'image' | 'studio', title?: string) => Promise<Session>;
  patchSession: (id: number, data: { title?: string }) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  refreshCurrent: () => Promise<void>;
  /** 해당 세션만 갱신. 현재 선택된 세션이면 currentSession도 갱신하고 true 반환, 아니면 목록만 갱신하고 false 반환 */
  refreshSession: (sessionId: number) => Promise<boolean>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const currentSessionIdRef = useRef<number | null>(null);
  currentSessionIdRef.current = currentSession?.id ?? null;

  const loadSessions = useCallback(async () => {
    try {
      const list = await sessionApi.list();
      setSessions(list);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCurrent = useCallback(async () => {
    if (!currentSession) return;
    try {
      const updated = await sessionApi.get(currentSession.id);
      setCurrentSession(updated);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch {
      // ignore
    }
  }, [currentSession?.id]);

  const refreshSession = useCallback(async (sessionId: number): Promise<boolean> => {
    const wasCurrent = currentSessionIdRef.current === sessionId;
    try {
      const updated = await sessionApi.get(sessionId);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setCurrentSession((curr) => (curr?.id === sessionId ? updated : curr));
      return wasCurrent;
    } catch {
      return false;
    }
  }, []);

  const createSession = useCallback(async (kind: 'chat' | 'image' | 'studio', title?: string) => {
    const session = await sessionApi.create(kind, title);
    setSessions((prev) => [session, ...prev]);
    setCurrentSession(session);
    return session;
  }, []);

  const selectSession = useCallback(async (session: Session | null) => {
    if (!session) {
      setCurrentSession(null);
      return;
    }
    const full = await sessionApi.get(session.id);
    setCurrentSession(full);
  }, []);

  const patchSession = useCallback(async (id: number, data: { title?: string }) => {
    const updated = await sessionApi.patch(id, data);
    setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    setCurrentSession((curr) => (curr?.id === id ? updated : curr));
  }, []);

  const deleteSession = useCallback(async (id: number) => {
    await sessionApi.delete(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setCurrentSession((curr) => (curr?.id === id ? null : curr));
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const value: AppContextValue = {
    sessions,
    currentSession,
    loading,
    loadSessions,
    selectSession,
    createSession,
    patchSession,
    deleteSession,
    refreshCurrent,
    refreshSession,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
