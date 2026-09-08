import type { Metadata } from 'next';
import StaffCatalogPanel from '@/components/StaffCatalogPanel';

export const metadata: Metadata = {
  title: 'Catálogo | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffCatalogPage() {
  return <StaffCatalogPanel />;
}
