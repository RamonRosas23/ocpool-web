import type { ReactNode } from 'react';
import PrivateShell from '@/components/private/PrivateShell';
import { PrivateToastProvider } from '@/components/private/ui/PrivateToast';
import { InboxProvider } from '@/components/inbox/InboxProvider';
import { getPrivateShellContext } from '@/server/private-shell';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';
import '@/components/private/ui/private-ui.css';
import '@/components/private/ui/private-surfaces.css';
import '@/components/inbox/inbox.css';

const PORTAL_NAVIGATION = [{ key: 'portal', href: '/portal', label: 'Mis expedientes', capability: 'requestsRead' }] as const;

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const wrap = (content: ReactNode) => <div className="private-ui-scope"><PrivateToastProvider><InboxProvider surface="portal">{content}</InboxProvider></PrivateToastProvider></div>;
  if (!readCommercialV2Flags().commercialWorkspaceV2) return wrap(children);
  const context = await getPrivateShellContext('portal');
  if (!context) return wrap(children);
  return wrap(<PrivateShell surface="portal" context={context} navigation={PORTAL_NAVIGATION}>{children}</PrivateShell>);
}
