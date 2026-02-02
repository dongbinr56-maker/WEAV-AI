import React, { useState, useRef, useEffect } from 'react';
import { Image, ChevronDown, ChevronRight, Trash2, Pencil } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
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
};

export function Sidebar({ open }: SidebarProps) {
  const { sessions, currentSession, selectSession, createSession, patchSession, deleteSession } = useApp();
  const [chatExpanded, setChatExpanded] = useState(true);
  const [imageExpanded, setImageExpanded] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const chatSessions = sessions.filter((s) => s.kind === 'chat');
  const imageSessions = sessions.filter((s) => s.kind === 'image');

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
    await createSession('chat', '새 채팅');
  };
  const handleNewImage = async () => {
    await createSession('image', '새 이미지');
  };
  const handleSelect = async (s: Session) => {
    await selectSession(s);
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setConfirmState({
      open: true,
      title: '채팅 삭제',
      message: '이 채팅을 삭제할까요?',
      onConfirm: async () => {
        await deleteSession(id);
        setConfirmState(null);
      },
    });
  };

  const handleDeleteImage = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setConfirmState({
      open: true,
      title: '이미지 세션 삭제',
      message: '이 이미지 세션을 삭제할까요?',
      onConfirm: async () => {
        await deleteSession(id);
        setConfirmState(null);
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
      className={`fixed left-0 top-14 bottom-0 w-72 bg-card text-foreground z-40 flex flex-col shadow-xl transition-[transform,opacity] duration-300 ease-out origin-left border-r border-border ${
        open ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'
      } ${!open ? 'pointer-events-none' : ''}`}
      aria-hidden={!open}
    >
        <div className="p-2 flex gap-2 shrink-0">
          <button
            ref={firstFocusableRef}
            type="button"
            onClick={handleNewChat}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-muted hover:bg-accent text-sm font-medium transition-colors duration-200"
          >
            <Pencil size={16} className="shrink-0" /> 새 채팅
          </button>
          <button
            type="button"
            onClick={handleNewImage}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-muted hover:bg-accent text-sm font-medium transition-colors duration-200"
          >
            <Image size={16} className="shrink-0" /> 새 이미지
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setChatExpanded((v) => !v)}
              className="w-full flex items-center gap-2 text-sm font-medium text-foreground px-2 py-2 rounded-lg hover:bg-accent/50 transition-colors duration-200"
            >
              {chatExpanded ? <ChevronDown size={16} className="transition-transform duration-200" /> : <ChevronRight size={16} className="transition-transform duration-200" />}
              채팅 {chatSessions.length > 0 && <span className="text-muted-foreground">({chatSessions.length})</span>}
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${chatExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="min-h-0 overflow-hidden">
                {chatSessions.length === 0 ? (
                  <p className="text-muted-foreground text-sm px-2 py-1">채팅 내역이 없습니다.</p>
                ) : (
                <>
                {chatSessions.map((s) => (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-1 rounded-lg text-sm ${
                      currentSession?.id === s.id ? 'bg-accent' : 'hover:bg-accent/50'
                    } transition-colors duration-200`}
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
                        className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-background border border-border rounded transition-colors duration-200"
                        placeholder="제목"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelect(s)}
                          className="flex-1 min-w-0 text-left px-3 py-2 truncate"
                        >
                          {s.title || `채팅 ${s.id}`}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => startEdit(e, s)}
                          className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-accent text-muted-foreground shrink-0"
                          title="제목 변경"
                          aria-label="제목 변경"
                        >
                          <Pencil size={14} />
                        </button>
                      </>
                    )}
                    {editingId !== s.id && (
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, s.id)}
                        className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-destructive/20 text-muted-foreground hover:text-destructive shrink-0"
                        title="채팅 삭제"
                        aria-label="채팅 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                </>
                )}
              </div>
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setImageExpanded((v) => !v)}
              className="w-full flex items-center gap-2 text-sm font-medium text-foreground px-2 py-2 rounded-lg hover:bg-accent/50 transition-colors duration-200"
            >
              {imageExpanded ? <ChevronDown size={16} className="transition-transform duration-200" /> : <ChevronRight size={16} className="transition-transform duration-200" />}
              이미지 {imageSessions.length > 0 && <span className="text-muted-foreground">({imageSessions.length})</span>}
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${imageExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="min-h-0 overflow-hidden">
                {imageSessions.length === 0 ? (
                  <p className="text-muted-foreground text-sm px-2 py-1">이미지 생성 내역이 없습니다.</p>
                ) : (
                <>
                {imageSessions.map((s) => (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-1 rounded-lg text-sm ${
                      currentSession?.id === s.id ? 'bg-accent' : 'hover:bg-accent/50'
                    } transition-colors duration-200`}
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
                        className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-background border border-border rounded"
                        placeholder="제목"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelect(s)}
                          className="flex-1 min-w-0 text-left px-3 py-2 truncate"
                        >
                          {s.title || `이미지 ${s.id}`}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => startEdit(e, s)}
                          className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-accent text-muted-foreground shrink-0"
                          title="제목 변경"
                          aria-label="제목 변경"
                        >
                          <Pencil size={14} />
                        </button>
                      </>
                    )}
                    {editingId !== s.id && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteImage(e, s.id)}
                        className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-destructive/20 text-muted-foreground hover:text-destructive shrink-0"
                        title="세션 삭제"
                        aria-label="세션 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                </>
                )}
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
