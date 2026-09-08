import type { Metadata } from 'next';
import AuthTokenPanel from '@/components/AuthTokenPanel';

export const metadata: Metadata = {
  title: 'Validando acceso | OCPOOL',
  robots: { index: false, follow: false },
};

export default function CustomerConsumeLinkPage() {
  return <AuthTokenPanel kind="customer" />;
}

