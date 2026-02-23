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
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';


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
      <div className="relative min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(1200px_620px_at_18%_-8%,rgba(132,114,190,0.2),transparent_62%),radial-gradient(980px_540px_at_84%_0%,rgba(101,112,166,0.16),transparent_60%),linear-gradient(180deg,#0d1017_0%,#0b0f16_56%,#090d13_100%)]" />
          <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(158,166,196,0.34)_1px,transparent_1px),linear-gradient(90deg,rgba(158,166,196,0.28)_1px,transparent_1px)] [background-size:34px_34px]" />
        </div>
        <AppHeader
          ref={menuButtonRef}
          sidebarOpen={sidebarOpen}
          onMenuClick={() => setSidebarOpen((v) => !v)}
        />
        <Sidebar open={sidebarOpen} onStudioClick={() => setShowStudioDialog(true)} />
        <main
          ref={mainRef}
          className={`flex-1 flex flex-col min-w-0 min-h-0 pt-14 transition-[margin] duration-300 ease-out ${
            sidebarOpen ? 'ml-72' : 'ml-0'
          }`}
        >
          {currentSession?.kind === 'studio' ? (
            <StudioView key={currentSession.id} sessionId={currentSession.id} projectName={currentSession.title} />
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
    <ErrorBoundary>
      <AppProvider>
        <ToastProvider>
          <ChatProvider>
            <AppContent />
          </ChatProvider>
        </ToastProvider>
      </AppProvider>
    </ErrorBoundary>
  );
}
