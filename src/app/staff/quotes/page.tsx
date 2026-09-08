import type { Metadata } from 'next';
import StaffQuotesPanel from '@/components/StaffQuotesPanel';

export const metadata: Metadata = {
  title: 'Cotizaciones | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffQuotesPage() {
  return <StaffQuotesPanel />;
}
