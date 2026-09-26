import type { ReactNode } from 'react';
import PrivateShell from '@/components/private/PrivateShell';
import { PrivateToastProvider } from '@/components/private/ui/PrivateToast';
import { visibleStaffNavigation } from '@/components/private/navigation';
import { StaffSessionProvider } from '@/components/staff/StaffSessionContext';
import { getPrivateShellContext, getStaffHeaderContext } from '@/server/private-shell';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';
import '@/components/private/ui/private-ui.css';
import '@/components/private/ui/private-surfaces.css';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  if (!readCommercialV2Flags().commercialWorkspaceV2) {
    // Identidad y permisos para el header compartido de staff (menú de cuenta, "Cerrar sesión",
    // navegación filtrada). Es un dato de presentación: una sola lectura sin transacción, y si
    // falla (p. ej. el pool de conexiones saturado) la página no debe caerse -- cada panel sigue
    // validando la sesión contra su propia API y el header se muestra sin menú de cuenta.
    const session = await getStaffHeaderContext().catch(() => null);
    return <div className="private-ui-scope"><PrivateToastProvider><StaffSessionProvider session={session}>{children}</StaffSessionProvider></PrivateToastProvider></div>;
  }
  const context = await getPrivateShellContext('staff');
  const content = <StaffSessionProvider session={context}>{children}</StaffSessionProvider>;
  if (!context) return <div className="private-ui-scope"><PrivateToastProvider>{content}</PrivateToastProvider></div>;
  return <div className="private-ui-scope"><PrivateToastProvider><PrivateShell surface="staff" context={context} navigation={visibleStaffNavigation(context.capabilities)}>{content}</PrivateShell></PrivateToastProvider></div>;
}
