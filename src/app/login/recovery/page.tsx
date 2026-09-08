import type { Metadata } from 'next';
import AuthEmailRequestPanel from '@/components/AuthEmailRequestPanel';

export const metadata: Metadata = {
  title: 'Recuperar acceso | OCPOOL',
  robots: { index: false, follow: false },
};

export default function RecoveryRequestPage() {
  return <AuthEmailRequestPanel kind="recovery" />;
}

