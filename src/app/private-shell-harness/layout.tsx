import type { ReactNode } from 'react';

import '@/components/private/ui/private-ui.css';
import '@/components/private/ui/private-surfaces.css';

export default function PrivateShellHarnessLayout({ children }: { children: ReactNode }) {
  return children;
}
