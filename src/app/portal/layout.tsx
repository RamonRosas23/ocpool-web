import type { ReactNode } from 'react';
import PrivateShell from '@/components/private/PrivateShell';
import { PrivateToastProvider } from '@/components/private/ui/PrivateToast';
import { getPrivateShellContext } from '@/server/private-shell';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';
import '@/components/private/ui/private-ui.css';

const PORTAL_NAVIGATION = [{ key: 'portal', href: '/portal', label: 'Mis expedientes', capability: 'requestsRead' }] as const;

export default async function PortalLayout({ children }: { children: ReactNode }) {
  if (!readCommercialV2Flags().commercialWorkspaceV2) return <div className="private-ui-scope"><PrivateToastProvider>{children}</PrivateToastProvider></div>;
  const context = await getPrivateShellContext('portal');
  if (!context) return <div className="private-ui-scope"><PrivateToastProvider>{children}</PrivateToastProvider></div>;
  return <div className="private-ui-scope"><PrivateToastProvider><PrivateShell surface="portal" context={context} navigation={PORTAL_NAVIGATION}>{children}</PrivateShell></PrivateToastProvider></div>;
}
