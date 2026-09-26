import type { ReactNode } from 'react';
import '@/components/private/ui/private-ui.css';
import '@/components/private/ui/private-surfaces.css';

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <div className="private-ui-scope">{children}</div>;
}
