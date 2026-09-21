import type { Metadata } from 'next';
import StaffApprovalsPanel from '@/components/StaffApprovalsPanel';

export const metadata: Metadata = {
  title: 'Aprobaciones | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffApprovalsPage() {
  return <StaffApprovalsPanel />;
}
