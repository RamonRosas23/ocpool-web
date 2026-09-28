import type { Metadata } from 'next';
import { Suspense } from 'react';
import StaffTeamPanel from '@/components/StaffTeamPanel';

export const metadata: Metadata = {
  title: 'Equipo | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffTeamPage() {
  return <Suspense fallback={null}><StaffTeamPanel /></Suspense>;
}
