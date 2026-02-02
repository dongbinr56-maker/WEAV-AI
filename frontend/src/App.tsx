import { useState, useRef, useEffect } from 'react';
import { AppProvider, useApp } from '@/contexts/AppContext';
import { ChatProvider } from '@/contexts/ChatContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { AppHeader } from '@/components/layout/AppHeader';
import { Sidebar } from '@/components/layout/Sidebar';
import { ChatView } from '@/components/chat/ChatView';

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const prevSidebarOpen = useRef(false);
  useApp();

  useEffect(() => {
    if (prevSidebarOpen.current && !sidebarOpen) {
      menuButtonRef.current?.focus();
    }
    prevSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppHeader
        ref={menuButtonRef}
        sidebarOpen={sidebarOpen}
        onMenuClick={() => setSidebarOpen((v) => !v)}
      />
      <Sidebar open={sidebarOpen} />
      <main
        className={`flex-1 flex flex-col min-w-0 min-h-0 transition-[margin] duration-300 ease-out ${
          sidebarOpen ? 'ml-72' : 'ml-0'
        }`}
      >
        <div className="flex-1 flex overflow-hidden">
          <ChatView />
        </div>
      </main>
    </div>
  );
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
