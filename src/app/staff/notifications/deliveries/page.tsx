import type { Metadata } from 'next';
import StaffEmailDeliveriesPanel from '@/components/StaffEmailDeliveriesPanel';

export const metadata: Metadata = {
  title: 'Entregas de correo | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffEmailDeliveriesPage() {
  return <StaffEmailDeliveriesPanel />;
}
