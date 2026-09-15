import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import StaffQuotesPanel from '@/components/StaffQuotesPanel';
import { normalizeRequestWorkspaceQuery, serializeRequestWorkspaceQuery } from '@/lib/request-workspace-query';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';

export const metadata: Metadata = {
  title: 'Cotizaciones | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LEGACY_QUEUE_KEYS = ['view', 'query', 'stage', 'assignee', 'age', 'sort', 'page'] as const;

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function StaffQuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const flags = readCommercialV2Flags();
  const params = await searchParams;
  const requestedId = typeof params.request === 'string' && REQUEST_ID_PATTERN.test(params.request) ? params.request : null;
  if (flags.commercialWorkspaceV2 && flags.requestWorkspaceV2 && requestedId) {
    const queueParams = new URLSearchParams();
    for (const key of LEGACY_QUEUE_KEYS) {
      const value = firstSearchParam(params[key]);
      if (value !== undefined) queueParams.set(key, value);
    }
    const queueQuery = normalizeRequestWorkspaceQuery(queueParams);
    const redirectQuery = serializeRequestWorkspaceQuery({ ...queueQuery, tab: 'quote' }).toString();
    redirect(`/staff/requests/${encodeURIComponent(requestedId)}${redirectQuery ? `?${redirectQuery}` : ''}`);
  }
  return <StaffQuotesPanel />;
}
