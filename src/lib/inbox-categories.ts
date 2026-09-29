/** Filtro "tipo" de la página de notificaciones. El servidor asigna cada tipo de aviso a una categoría. */
export const INBOX_CATEGORIES = ['requests', 'activity', 'quotes', 'prices', 'projects', 'email'] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

export const INBOX_CATEGORY_LABELS: Readonly<Record<InboxCategory, string>> = {
  requests: 'Solicitudes y asignaciones',
  activity: 'Mensajes, archivos y notas',
  quotes: 'Propuestas y aprobaciones',
  prices: 'Precios',
  projects: 'Proyectos',
  email: 'Correos no entregados',
};

export function isInboxCategory(value: unknown): value is InboxCategory {
  return typeof value === 'string' && (INBOX_CATEGORIES as readonly string[]).includes(value);
}
