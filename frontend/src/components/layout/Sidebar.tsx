import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Trash2, Pencil, Youtube, CheckSquare, X } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { Session } from '@/types';

type ConfirmState = {
  open: true;
  title: string;
  message: string;
  onConfirm: () => void;
};

type SidebarProps = {
  open: boolean;
  onStudioClick?: () => void;
};

export function Sidebar({ open, onStudioClick }: SidebarProps) {
  const { sessions, currentSession, selectSession, createSession, patchSession, deleteSession, deleteSessions } = useApp();
  const { showToast } = useToast();
  const [chatExpanded, setChatExpanded] = useState(true);
  const [studioExpanded, setStudioExpanded] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const chatSessions = sessions.filter((s) => s.kind === 'chat');
  const studioSessions = sessions.filter((s) => s.kind === 'studio');

  useEffect(() => {
    if (editingId !== null) {
      setEditingTitle(sessions.find((s) => s.id === editingId)?.title ?? '');
      inputRef.current?.focus();
    }
  }, [editingId, sessions]);

  useEffect(() => {
    if (open) {
      firstFocusableRef.current?.focus();
    }
  }, [open]);

  const handleNewChat = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createSession('chat', '새 채팅');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '새 채팅을 만들 수 없습니다';
      console.error('[Sidebar] createSession failed:', e);
      showToast(msg);
    } finally {
      setCreating(false);
    }
  };
  const handleSelect = async (s: Session) => {
    await selectSession(s);
  };

  const setDeletingState = (ids: number[], deleting: boolean) => {
    setDeletingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => {
        if (deleting) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  const runDeleteSession = async (id: number) => {
    setConfirmState(null);
    setDeletingState([id], true);
    try {
      await deleteSession(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '삭제에 실패했습니다.';
      showToast(msg);
    } finally {
      setDeletingState([id], false);
    }
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setConfirmState({
      open: true,
      title: '채팅 삭제',
      message: '이 채팅을 삭제할까요?',
      onConfirm: () => {
        void runDeleteSession(id);
      },
    });
  };

  const handleDeleteStudio = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setConfirmState({
      open: true,
      title: 'WEAV Studio 프로젝트 삭제',
      message: '이 프로젝트를 삭제할까요?',
      onConfirm: () => {
        void runDeleteSession(id);
      },
    });
  };

  const toggleSelectMode = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingId(null);
    setSelectMode((prev) => {
      const next = !prev;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const selectedSessions = sessions.filter((s) => selectedIds.has(s.id));
    const chatCount = selectedSessions.filter((s) => s.kind === 'chat').length;
    const studioCount = selectedSessions.filter((s) => s.kind === 'studio').length;
    const suffix = [chatCount ? `채팅 ${chatCount}개` : null, studioCount ? `Studio ${studioCount}개` : null]
      .filter(Boolean)
      .join(', ');
    setConfirmState({
      open: true,
      title: '선택한 내역 삭제',
      message: `선택한 ${ids.length}개의 내역을 삭제할까요?${suffix ? ` (${suffix})` : ''}`,
      onConfirm: async () => {
        setConfirmState(null);
        setDeletingState(ids, true);
        try {
          const { failedIds } = await deleteSessions(ids);
          if (failedIds.length > 0) {
            showToast(`${failedIds.length}개 삭제에 실패했습니다.`);
            setSelectedIds(new Set(failedIds));
            return;
          }
          setSelectedIds(new Set());
          setSelectMode(false);
        } catch (e) {
          const msg = e instanceof Error ? e.message : '삭제에 실패했습니다.';
          showToast(msg);
        } finally {
          setDeletingState(ids, false);
        }
      },
    });
  };

  const startEdit = (e: React.MouseEvent, s: Session) => {
    e.stopPropagation();
    setEditingId(s.id);
  };

  const saveTitle = async () => {
    if (editingId === null) return;
    const trimmed = editingTitle.trim();
    if (trimmed) await patchSession(editingId, { title: trimmed });
    setEditingId(null);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    }
    if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  return (
    <>
    <aside
      className={`fixed left-0 top-14 bottom-0 w-72 bg-card/84 text-foreground z-40 flex flex-col backdrop-blur-xl transition-[transform,opacity] duration-300 ease-out origin-left border-r border-border/60 overflow-hidden ${
        open ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'
      } ${!open ? 'pointer-events-none' : ''}`}
      aria-hidden={!open}
    >
        <div className="p-2 flex flex-col gap-2 shrink-0 relative z-10">
          <button
            ref={firstFocusableRef}
            type="button"
            onClick={onStudioClick}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/70 bg-secondary/55 hover:bg-secondary/75 text-sm font-medium transition-colors duration-200"
          >
            <Youtube size={18} className="shrink-0" /> WEAV Studio
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            disabled={creating}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-primary/40 bg-primary/16 text-foreground text-sm font-semibold hover:bg-primary/22 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {creating ? '…' : <Pencil size={16} className="shrink-0" />} 새 채팅
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 min-h-0 relative z-10">
          <div className="flex flex-col gap-4">
          {selectMode && (
            <div className="flex items-center justify-between gap-2 px-2 py-2 rounded-lg border border-border/70 bg-secondary/35">
              <div className="text-sm text-muted-foreground">
                {selectedIds.size}개 선택됨
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={selectedIds.size === 0 || deletingIds.size > 0}
                  className="px-2 py-1.5 rounded-md text-sm font-medium border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                  aria-label="선택 삭제"
                  title="선택 삭제"
                >
                  <span className="inline-flex items-center gap-1">
                    <Trash2 size={14} /> 삭제
                  </span>
                </button>
                <button
                  type="button"
                  onClick={toggleSelectMode}
                  className="p-2 rounded-md hover:bg-secondary/70 text-muted-foreground transition-colors duration-200"
                  aria-label="선택 모드 종료"
                  title="선택 모드 종료"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
          <div>
            <div className="w-full flex items-center gap-1">
              <button
                type="button"
                onClick={() => setChatExpanded((v) => !v)}
                className="flex-1 flex items-center gap-2 text-sm font-medium text-foreground px-2 py-2 rounded-lg hover:bg-secondary/80 transition-colors duration-200"
              >
                {chatExpanded ? <ChevronDown size={16} className="transition-transform duration-200" /> : <ChevronRight size={16} className="transition-transform duration-200" />}
                채팅 {chatSessions.length > 0 && <span className="text-muted-foreground">({chatSessions.length})</span>}
              </button>
              <button
                type="button"
                onClick={toggleSelectMode}
                className={`p-2 rounded-lg transition-colors duration-200 ${
                  selectMode ? 'bg-primary/12 text-primary' : 'hover:bg-secondary/80 text-muted-foreground'
                }`}
                aria-label={selectMode ? '선택 모드 종료' : '선택 모드'}
                title={selectMode ? '선택 모드 종료' : '선택 모드'}
              >
                <CheckSquare size={16} />
              </button>
            </div>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${chatExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="min-h-0 overflow-hidden">
                {chatSessions.length === 0 ? (
                  <p className="text-muted-foreground text-sm px-2 py-1">채팅 내역이 없습니다.</p>
                ) : (
                <>
                {chatSessions.map((s) => {
                  const isDeleting = deletingIds.has(s.id);
                  return (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-1 rounded-lg text-sm border ${
                      selectMode
                        ? selectedIds.has(s.id)
                          ? 'bg-primary/12 border-primary/40'
                          : 'border-transparent hover:bg-secondary/60'
                        : currentSession?.id === s.id
                          ? 'bg-primary/12 border-primary/40'
                          : 'border-transparent hover:bg-secondary/60'
                    } ${isDeleting ? 'opacity-60' : ''} transition-colors duration-200`}
                    onClick={() => {
                      if (isDeleting) return;
                      if (!selectMode) return;
                      toggleSelected(s.id);
                    }}
                  >
                    {editingId === s.id ? (
                      <input
                        ref={editingId === s.id ? inputRef : undefined}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={handleTitleKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-background/70 border border-border rounded transition-colors duration-200"
                        placeholder="제목"
                      />
                    ) : (
                      <>
                        {selectMode && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleSelected(s.id)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={isDeleting}
                            className="ml-2 h-4 w-4 accent-primary"
                            aria-label={`${s.title || `채팅 ${s.id}`} 선택`}
                          />
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            if (isDeleting) {
                              e.stopPropagation();
                              return;
                            }
                            if (selectMode) {
                              e.stopPropagation();
                              toggleSelected(s.id);
                              return;
                            }
                            handleSelect(s);
                          }}
                          disabled={isDeleting}
                          className={`flex-1 min-w-0 text-left truncate ${selectMode ? 'px-2 py-2' : 'px-3 py-2'}`}
                        >
                          {s.title || `채팅 ${s.id}`}
                        </button>
                        {!selectMode && (
                          <button
                            type="button"
                            onClick={(e) => startEdit(e, s)}
                            disabled={isDeleting}
                            className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-secondary text-muted-foreground shrink-0"
                            title="제목 변경"
                            aria-label="제목 변경"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                      </>
                    )}
                    {!selectMode && editingId !== s.id && (
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, s.id)}
                        disabled={isDeleting}
                        className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-destructive/20 text-muted-foreground hover:text-destructive shrink-0"
                        title="채팅 삭제"
                        aria-label="채팅 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  );
                })}
                </>
                )}
              </div>
            </div>
          </div>
          <div>
            <div className="w-full flex items-center gap-1">
              <button
                type="button"
                onClick={() => setStudioExpanded((v) => !v)}
                className="flex-1 flex items-center gap-2 text-sm font-medium text-foreground px-2 py-2 rounded-lg hover:bg-secondary/80 transition-colors duration-200"
              >
                {studioExpanded ? <ChevronDown size={16} className="transition-transform duration-200" /> : <ChevronRight size={16} className="transition-transform duration-200" />}
                WEAV Studio {studioSessions.length > 0 && <span className="text-muted-foreground">({studioSessions.length})</span>}
              </button>
              <button
                type="button"
                onClick={toggleSelectMode}
                className={`p-2 rounded-lg transition-colors duration-200 ${
                  selectMode ? 'bg-primary/12 text-primary' : 'hover:bg-secondary/80 text-muted-foreground'
                }`}
                aria-label={selectMode ? '선택 모드 종료' : '선택 모드'}
                title={selectMode ? '선택 모드 종료' : '선택 모드'}
              >
                <CheckSquare size={16} />
              </button>
            </div>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${studioExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="min-h-0 overflow-hidden">
                {studioSessions.length === 0 ? (
                  <p className="text-muted-foreground text-sm px-2 py-1">WEAV Studio 프로젝트가 없습니다.</p>
                ) : (
                <>
                {studioSessions.map((s) => {
                  const isDeleting = deletingIds.has(s.id);
                  return (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-1 rounded-lg text-sm border ${
                      selectMode
                        ? selectedIds.has(s.id)
                          ? 'bg-primary/12 border-primary/40'
                          : 'border-transparent hover:bg-secondary/60'
                        : currentSession?.id === s.id
                          ? 'bg-primary/12 border-primary/40'
                          : 'border-transparent hover:bg-secondary/60'
                    } ${isDeleting ? 'opacity-60' : ''} transition-colors duration-200`}
                    onClick={() => {
                      if (isDeleting) return;
                      if (!selectMode) return;
                      toggleSelected(s.id);
                    }}
                  >
                    {editingId === s.id ? (
                      <input
                        ref={editingId === s.id ? inputRef : undefined}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={handleTitleKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-background/70 border border-border rounded transition-colors duration-200"
                        placeholder="제목"
                      />
                    ) : (
                      <>
                        {selectMode && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleSelected(s.id)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={isDeleting}
                            className="ml-2 h-4 w-4 accent-primary"
                            aria-label={`${s.title || `Studio ${s.id}`} 선택`}
                          />
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            if (isDeleting) {
                              e.stopPropagation();
                              return;
                            }
                            if (selectMode) {
                              e.stopPropagation();
                              toggleSelected(s.id);
                              return;
                            }
                            handleSelect(s);
                          }}
                          disabled={isDeleting}
                          className={`flex-1 min-w-0 text-left truncate ${selectMode ? 'px-2 py-2' : 'px-3 py-2'}`}
                        >
                          {s.title || `Studio ${s.id}`}
                        </button>
                        {!selectMode && (
                          <button
                            type="button"
                            onClick={(e) => startEdit(e, s)}
                            disabled={isDeleting}
                            className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-secondary text-muted-foreground shrink-0"
                            title="제목 변경"
                            aria-label="제목 변경"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                      </>
                    )}
                    {!selectMode && editingId !== s.id && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteStudio(e, s.id)}
                        disabled={isDeleting}
                        className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-destructive/20 text-muted-foreground hover:text-destructive shrink-0"
                        title="프로젝트 삭제"
                        aria-label="프로젝트 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  );
                })}
                </>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>
      </aside>
      {confirmState && (
        <ConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel="삭제"
          cancelLabel="취소"
          variant="destructive"
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  );
}
