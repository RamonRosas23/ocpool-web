import type { Metadata } from 'next';
import AuthEmailRequestPanel from '@/components/AuthEmailRequestPanel';

export const metadata: Metadata = {
  title: 'Acceso al portal | OCPOOL',
  robots: { index: false, follow: false },
};

export default function PortalAccessPage() {
  return <AuthEmailRequestPanel kind="customer" />;
}

