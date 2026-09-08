import type { Metadata } from 'next';
import AuthTokenPanel from '@/components/AuthTokenPanel';

export const metadata: Metadata = {
  title: 'Actualizar acceso | OCPOOL',
  robots: { index: false, follow: false },
};

export default function RecoveryConsumePage() {
  return <AuthTokenPanel kind="recovery" />;
}

