import type { Metadata } from 'next';
import StaffInboxPanel from '@/components/StaffInboxPanel';

export const metadata: Metadata = {
  title: 'Notificaciones | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffNotificationsPage() {
  return <StaffInboxPanel />;
}
