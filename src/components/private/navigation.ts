import type { PrivateShellSurface } from '@/server/private-shell';

export type PrivateStaffCapabilities = Readonly<{
  metricsRead?: boolean;
  requestsRead?: boolean;
  /** requests.claim: puede tomar solicitudes sin responsable (acción "Tomar" de la campana). */
  requestsClaim?: boolean;
  quotesRead?: boolean;
  catalogRead?: boolean;
  notificationsRead?: boolean;
  notificationsManage?: boolean;
  auditRead?: boolean;
  approvalsRead?: boolean;
  projectsRead?: boolean;
  projectsManage?: boolean;
  /** prices.manage: asignar precios en las listas (y ver "Precios por asignar"). */
  pricesManage?: boolean;
  /** identity.users.manage: invitar, cambiar roles y suspender accesos (Equipo). */
  teamManage?: boolean;
}>;

export type PrivateNavigationItem = {
  key: string;
  href: string;
  label: string;
  capability: keyof PrivateStaffCapabilities;
};

export type PrivateShellTrail = Readonly<{
  currentLabel: string;
  returnHref: string;
  returnLabel: string;
}>;

export const STAFF_NAVIGATION: readonly PrivateNavigationItem[] = Object.freeze([
  { key: 'dashboard', href: '/staff', label: 'Dashboard', capability: 'metricsRead' },
  { key: 'requests', href: '/staff/requests', label: 'Solicitudes', capability: 'requestsRead' },
  { key: 'quotes', href: '/staff/quotes', label: 'Cotizaciones', capability: 'quotesRead' },
  { key: 'projects', href: '/staff/projects', label: 'Proyectos', capability: 'projectsRead' },
  { key: 'catalog', href: '/staff/catalog', label: 'Catálogo', capability: 'catalogRead' },
  { key: 'notifications', href: '/staff/notifications', label: 'Notificaciones', capability: 'notificationsRead' },
  { key: 'audit', href: '/staff/audit', label: 'Auditoría', capability: 'auditRead' },
  { key: 'team', href: '/staff/team', label: 'Equipo', capability: 'teamManage' },
] as const);

export function visibleStaffNavigation(capabilities: PrivateStaffCapabilities): PrivateNavigationItem[] {
  return STAFF_NAVIGATION.filter((item) => capabilities[item.capability] === true);
}

export function pathMatches(pathname: string, href: string): boolean {
  return href === '/staff' || href === '/portal' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function privateShellTrail(
  pathname: string,
  surface: PrivateShellSurface,
  navigation: readonly PrivateNavigationItem[],
): PrivateShellTrail | null {
  const rootHref = surface === 'staff' ? '/staff' : '/portal';
  const current = [...navigation]
    .filter((item) => pathMatches(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0];

  if (!current || current.href === rootHref) return null;

  return {
    currentLabel: current.label,
    returnHref: rootHref,
    returnLabel: surface === 'staff' ? 'Dashboard' : 'Mis expedientes',
  };
}
