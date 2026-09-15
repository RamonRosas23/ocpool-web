import type { Metadata } from 'next';
import StaffRequestsPanel from '@/components/StaffRequestsPanel';
import RequestWorkspaceV2Panel from '@/components/RequestWorkspaceV2Panel';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';

export const metadata: Metadata = {
  title: 'Solicitudes | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffRequestsPage() {
  const flags = readCommercialV2Flags();
  if (flags.commercialWorkspaceV2 && flags.requestWorkspaceV2) return <RequestWorkspaceV2Panel />;
  return <StaffRequestsPanel />;
}
