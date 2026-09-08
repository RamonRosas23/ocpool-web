import type { Metadata } from 'next';
import StaffAuditPanel from '@/components/StaffAuditPanel';

export const metadata: Metadata = {
  title: 'Auditoría | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffAuditPage() {
  return <StaffAuditPanel />;
}
