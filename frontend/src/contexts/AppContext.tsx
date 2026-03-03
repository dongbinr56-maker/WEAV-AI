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
  patchSession: (id: number, data: { title?: string; reference_image_urls?: string[] }) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  deleteSessions: (ids: number[]) => Promise<{ deletedIds: number[]; failedIds: number[] }>;
  refreshCurrent: () => Promise<void>;
  /** 해당 세션만 갱신. 현재 선택된 세션이면 currentSession도 갱신하고 true 반환, 아니면 목록만 갱신하고 false 반환 */
  refreshSession: (sessionId: number) => Promise<boolean>;
};

const AppContext = createContext<AppContextValue | null>(null);
const LAST_SESSION_KEY = 'weav:lastSessionId';

const readLastSessionId = (): number | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(LAST_SESSION_KEY);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
};

const writeLastSessionId = (id: number | null) => {
  if (typeof window === 'undefined') return;
  if (id == null) {
    window.localStorage.removeItem(LAST_SESSION_KEY);
  } else {
    window.localStorage.setItem(LAST_SESSION_KEY, String(id));
  }
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const currentSessionIdRef = useRef<number | null>(null);
  const restoredRef = useRef(false);
  currentSessionIdRef.current = currentSession?.id ?? null;

  const loadSessions = useCallback(async () => {
    try {
      const list = await sessionApi.list();
      setSessions(list);
      if (!currentSessionIdRef.current && !restoredRef.current) {
        const storedId = readLastSessionId();
        if (storedId != null) {
          const found = list.find((s) => s.id === storedId);
          if (found) {
            try {
              const full = await sessionApi.get(storedId);
              setCurrentSession(full);
            } catch {
              writeLastSessionId(null);
            }
          } else {
            writeLastSessionId(null);
          }
        }
        restoredRef.current = true;
      }
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
    writeLastSessionId(session.id);
    return session;
  }, []);

  const selectSession = useCallback(async (session: Session | null) => {
    if (!session) {
      setCurrentSession(null);
      writeLastSessionId(null);
      return;
    }
    const full = await sessionApi.get(session.id);
    setCurrentSession(full);
    writeLastSessionId(full.id);
  }, []);

  const patchSession = useCallback(async (id: number, data: { title?: string; reference_image_urls?: string[] }) => {
    const updated = await sessionApi.patch(id, data);
    setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    setCurrentSession((curr) => (curr?.id === id ? updated : curr));
  }, []);

  const deleteSession = useCallback(async (id: number) => {
    await sessionApi.delete(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setCurrentSession((curr) => (curr?.id === id ? null : curr));
    if (readLastSessionId() === id) {
      writeLastSessionId(null);
    }
  }, []);

  const deleteSessions = useCallback(async (ids: number[]) => {
    const normalized = Array.from(new Set(ids)).filter((v) => Number.isFinite(v) && v > 0);
    if (normalized.length === 0) return { deletedIds: [], failedIds: [] };

    const res = await sessionApi.bulkDelete(normalized);
    const failed = new Set<number>([...(res.not_found ?? []), ...(res.forbidden ?? [])]);
    const deletedIds = normalized.filter((id) => !failed.has(id));
    const deletedSet = new Set(deletedIds);

    setSessions((prev) => prev.filter((s) => !deletedSet.has(s.id)));
    setCurrentSession((curr) => (curr && deletedSet.has(curr.id) ? null : curr));
    const last = readLastSessionId();
    if (last != null && deletedSet.has(last)) {
      writeLastSessionId(null);
    }
    return { deletedIds, failedIds: Array.from(failed) };
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
    deleteSessions,
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
