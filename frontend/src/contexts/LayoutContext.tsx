import React, { createContext, useContext } from 'react';

type LayoutContextValue = {
  sidebarOpen: boolean;
};

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({
  children,
  sidebarOpen,
}: {
  children: React.ReactNode;
  sidebarOpen: boolean;
}) {
  return (
    <LayoutContext.Provider value={{ sidebarOpen }}>{children}</LayoutContext.Provider>
  );
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) return { sidebarOpen: false };
  return ctx;
}
