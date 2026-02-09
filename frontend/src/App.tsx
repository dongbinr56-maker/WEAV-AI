import { useState, useRef, useEffect } from 'react';
import { AppProvider, useApp } from '@/contexts/AppContext';
import { ChatProvider } from '@/contexts/ChatContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { LayoutProvider } from '@/contexts/LayoutContext';
import { AppHeader } from '@/components/layout/AppHeader';
import { Sidebar } from '@/components/layout/Sidebar';
import { ChatView } from '@/components/chat/ChatView';
import { StudioView } from '@/components/studio/StudioView';
import { InputDialog } from '@/components/ui/InputDialog';


function AppContentInner() {
  const { currentSession, createSession } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showStudioDialog, setShowStudioDialog] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const prevSidebarOpen = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (prevSidebarOpen.current && !sidebarOpen) {
      menuButtonRef.current?.focus();
    }
    prevSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);

  useEffect(() => {
    // WEAV Studio 화면으로 전환 시 스크롤을 최상단으로 이동
    if (currentSession?.kind === 'studio' && mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [currentSession?.kind, currentSession?.id]);

  return (
    <LayoutProvider sidebarOpen={sidebarOpen}>
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <AppHeader
          ref={menuButtonRef}
          sidebarOpen={sidebarOpen}
          onMenuClick={() => setSidebarOpen((v) => !v)}
        />
        <Sidebar open={sidebarOpen} onStudioClick={() => setShowStudioDialog(true)} />
        <main
          ref={mainRef}
          className={`flex-1 flex flex-col min-w-0 min-h-0 transition-[margin] duration-300 ease-out ${
            sidebarOpen ? 'ml-72' : 'ml-0'
          }`}
        >
          {currentSession?.kind === 'studio' ? (
            <StudioView projectName={currentSession.title} />
          ) : (
            <div className="flex-1 flex overflow-hidden">
              <ChatView />
            </div>
          )}
        </main>
        <InputDialog
          open={showStudioDialog}
          title="WEAV Studio 프로젝트 생성"
          message="프로젝트 이름을 입력하세요"
          placeholder="예: 나의 첫 번째 영상"
          confirmLabel="생성"
          cancelLabel="취소"
          onConfirm={async (name) => {
            await createSession('studio', name);
            setShowStudioDialog(false);
          }}
          onCancel={() => {
            setShowStudioDialog(false);
          }}
        />
      </div>
    </LayoutProvider>
  );
}

function AppContent() {
  return <AppContentInner />;
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <ChatProvider>
          <AppContent />
        </ChatProvider>
      </ToastProvider>
    </AppProvider>
  );
}
