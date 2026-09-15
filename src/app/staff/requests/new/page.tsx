import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import StaffRequestCreateV2Panel from '@/components/StaffRequestCreateV2Panel';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';

export const metadata: Metadata = {
  title: 'Nueva solicitud | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function NewStaffRequestPage() {
  const flags = readCommercialV2Flags();
  if (!flags.commercialWorkspaceV2 || !flags.requestWorkspaceV2) notFound();
  return <StaffRequestCreateV2Panel />;
}
