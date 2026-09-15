'use client';

import type { ReactNode } from 'react';
import { usePrivateShellContext } from './PrivateShellContext';

export default function PrivateSurfaceRoot({ className, children }: { className: string; children: ReactNode }) {
  const insidePrivateShell = usePrivateShellContext();
  return insidePrivateShell ? <div className={className}>{children}</div> : <main className={className}>{children}</main>;
}
