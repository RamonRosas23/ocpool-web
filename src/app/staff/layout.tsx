import type { ReactNode } from 'react';
import PrivateShell from '@/components/private/PrivateShell';
import { PrivateToastProvider } from '@/components/private/ui/PrivateToast';
import { visibleStaffNavigation } from '@/components/private/navigation';
import { StaffSessionProvider } from '@/components/staff/StaffSessionContext';
import { getPrivateShellContext } from '@/server/private-shell';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';
import '@/components/private/ui/private-ui.css';
import '@/components/private/ui/private-surfaces.css';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  // Se resuelve siempre (no sólo con el shell V2) para que el header de staff pueda mostrar la
  // identidad, filtrar la navegación por permisos y ofrecer "Cerrar sesión" en todas las vistas.
  // Es un dato de presentación: si la lectura falla (p. ej. una transacción que expira bajo carga)
  // la página no debe caerse -- cada panel sigue validando la sesión por su cuenta contra su API y el
  // header simplemente se muestra sin menú de cuenta.
  const context = await getPrivateShellContext('staff').catch(() => null);
  const content = <StaffSessionProvider session={context}>{children}</StaffSessionProvider>;
  if (!readCommercialV2Flags().commercialWorkspaceV2 || !context) return <div className="private-ui-scope"><PrivateToastProvider>{content}</PrivateToastProvider></div>;
  return <div className="private-ui-scope"><PrivateToastProvider><PrivateShell surface="staff" context={context} navigation={visibleStaffNavigation(context.capabilities)}>{content}</PrivateShell></PrivateToastProvider></div>;
}
