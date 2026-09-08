import type { Metadata } from 'next';
import ClientPortalPanel from '@/components/ClientPortalPanel';

export const metadata: Metadata = {
  title: 'Portal de cliente | OCPOOL',
  robots: { index: false, follow: false },
};

export default function ClientPortalPage() {
  return <ClientPortalPanel />;
}
