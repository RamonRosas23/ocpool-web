export type PrivateStaffCapabilities = Readonly<{
  metricsRead?: boolean;
  requestsRead?: boolean;
  quotesRead?: boolean;
  catalogRead?: boolean;
  notificationsRead?: boolean;
  auditRead?: boolean;
}>;

export type PrivateNavigationItem = {
  key: string;
  href: string;
  label: string;
  capability: keyof PrivateStaffCapabilities;
};

export const STAFF_NAVIGATION: readonly PrivateNavigationItem[] = Object.freeze([
  { key: 'dashboard', href: '/staff', label: 'Dashboard', capability: 'metricsRead' },
  { key: 'requests', href: '/staff/requests', label: 'Solicitudes', capability: 'requestsRead' },
  { key: 'quotes', href: '/staff/quotes', label: 'Cotizaciones', capability: 'quotesRead' },
  { key: 'catalog', href: '/staff/catalog', label: 'Catálogo', capability: 'catalogRead' },
  { key: 'notifications', href: '/staff/notifications', label: 'Notificaciones', capability: 'notificationsRead' },
  { key: 'audit', href: '/staff/audit', label: 'Auditoría', capability: 'auditRead' },
] as const);

export function visibleStaffNavigation(capabilities: PrivateStaffCapabilities): PrivateNavigationItem[] {
  return STAFF_NAVIGATION.filter((item) => capabilities[item.capability] === true);
}
