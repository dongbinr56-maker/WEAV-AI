import { forwardRef } from 'react';
import { Menu } from 'lucide-react';

type AppHeaderProps = {
  sidebarOpen: boolean;
  onMenuClick: () => void;
};

export const AppHeader = forwardRef<HTMLButtonElement, AppHeaderProps>(function AppHeader(
  { sidebarOpen, onMenuClick },
  ref
) {
  return (
    <header className="sticky top-0 z-30 flex items-center h-14 px-4 bg-card border-b border-border transition-colors duration-200">
      <button
        ref={ref}
        type="button"
        onClick={onMenuClick}
        className="p-2 rounded hover:bg-accent text-primary-foreground transition-colors duration-200"
        aria-label={sidebarOpen ? '메뉴 닫기' : '메뉴 열기'}
        aria-expanded={sidebarOpen}
        title={sidebarOpen ? '메뉴 닫기' : '메뉴 열기'}
      >
        <Menu size={24} />
      </button>
      <span className="ml-3 font-semibold text-foreground">WEAV AI</span>
    </header>
  );
});
