import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import RequestWorkspaceDetailV2 from '@/components/RequestWorkspaceDetailV2';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';

export const metadata: Metadata = {
  title: 'Expediente | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default async function StaffRequestDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const flags = readCommercialV2Flags();
  if (!flags.commercialWorkspaceV2 || !flags.requestWorkspaceV2) notFound();
  const { requestId } = await params;
  return <RequestWorkspaceDetailV2 requestId={requestId} />;
}
