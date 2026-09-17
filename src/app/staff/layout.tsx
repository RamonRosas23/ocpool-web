import type { ReactNode } from 'react';
import PrivateShell from '@/components/private/PrivateShell';
import { PrivateToastProvider } from '@/components/private/ui/PrivateToast';
import { visibleStaffNavigation } from '@/components/private/navigation';
import { getPrivateShellContext } from '@/server/private-shell';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';
import '@/components/private/ui/private-ui.css';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  if (!readCommercialV2Flags().commercialWorkspaceV2) return <PrivateToastProvider>{children}</PrivateToastProvider>;
  const context = await getPrivateShellContext('staff');
  if (!context) return <PrivateToastProvider>{children}</PrivateToastProvider>;
  return <PrivateToastProvider><PrivateShell surface="staff" context={context} navigation={visibleStaffNavigation(context.capabilities)}>{children}</PrivateShell></PrivateToastProvider>;
}
