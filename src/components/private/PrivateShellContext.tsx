'use client';

import { createContext, useContext, type ReactNode } from 'react';

const PrivateShellContext = createContext(false);

export function PrivateShellProvider({ children }: { children: ReactNode }) {
  return <PrivateShellContext.Provider value>{children}</PrivateShellContext.Provider>;
}

export function usePrivateShellContext(): boolean {
  return useContext(PrivateShellContext);
}
