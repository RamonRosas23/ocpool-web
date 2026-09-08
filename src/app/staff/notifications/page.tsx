import type { Metadata } from 'next';
import StaffNotificationsPanel from '@/components/StaffNotificationsPanel';

export const metadata: Metadata = {
  title: 'Notificaciones | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffNotificationsPage() {
  return <StaffNotificationsPanel />;
}

