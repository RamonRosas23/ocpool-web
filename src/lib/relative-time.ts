import { formatDate, formatDateTime } from '@/lib/format-date';

// Lectura rápida de "qué tan reciente es" en listas operativas: "hace 5 min", "hace 3 h", "ayer",
// "hace 4 días". Pasada una semana la distancia relativa deja de ser útil y se muestra la fecha
// real. El valor exacto nunca se pierde: la vista lo expone completo en `title`/`dateTime`.
export function relativeTimeLabel(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return 'Fecha por confirmar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha por confirmar';
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return formatDateTime(value);
  if (seconds < 60) return 'Hace un momento';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  return formatDate(value);
}
