import type { Metadata } from 'next';
import StaffAccountPanel from '@/components/StaffAccountPanel';

export const metadata: Metadata = {
  title: 'Mi cuenta | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffAccountPage() {
  return <StaffAccountPanel />;
}
