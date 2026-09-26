import type { Metadata } from 'next';
import StaffProjectsPanel from '@/components/StaffProjectsPanel';

export const metadata: Metadata = {
  title: 'Proyectos | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffProjectsPage() {
  return <StaffProjectsPanel />;
}
