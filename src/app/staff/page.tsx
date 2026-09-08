import type { Metadata } from 'next';
import StaffDashboardPanel from '@/components/StaffDashboardPanel';

export const metadata: Metadata = {
  title: 'Dashboard | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffDashboardPage() {
  return <StaffDashboardPanel />;
}
