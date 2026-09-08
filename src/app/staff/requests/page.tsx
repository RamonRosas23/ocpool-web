import type { Metadata } from 'next';
import StaffRequestsPanel from '@/components/StaffRequestsPanel';

export const metadata: Metadata = {
  title: 'Solicitudes | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffRequestsPage() {
  return <StaffRequestsPanel />;
}
