// Nombres legibles para la operación; la clave técnica se sigue mostrando al lado (en `code`)
// porque es la que se busca en logs y en el proveedor de correo al diagnosticar un fallo.
export const TEMPLATE_LABELS: Record<string, string> = {
  'request.received': 'Acuse de solicitud recibida',
  'request.assigned': 'Aviso de asignación',
  'message.created': 'Aviso de mensaje nuevo',
  'file.available': 'Aviso de archivo disponible',
  'quote.version_sent': 'Cotización enviada al cliente',
  'quote.accepted': 'Aviso de cotización aceptada',
  'quote.acceptance_confirmed': 'Confirmación de aceptación',
  'quote.approval_requested': 'Solicitud de aprobación',
  'quote.approval_resolved': 'Resolución de aprobación',
  'request.new_for_team': 'Aviso de solicitud nueva al equipo',
  'quote.changes_requested': 'Aviso de cambios pedidos',
  'system.cancelled': 'Cancelada por el sistema',
};

export const EVENT_LABELS: Record<string, string> = {
  'REQUEST.RECEIVED': 'Solicitud recibida',
  'REQUEST.ASSIGNED': 'Solicitud asignada',
  'MESSAGE.CREATED': 'Mensaje nuevo',
  'FILE.AVAILABLE': 'Archivo disponible',
  'QUOTE.PUBLISHED': 'Cotización publicada',
  'QUOTE.VERSION_STATUS_CHANGED': 'Cambio de estado de cotización',
  'QUOTE.ACCEPTED': 'Cotización aceptada',
  'QUOTE.APPROVAL_REQUESTED': 'Aprobación solicitada',
  'QUOTE.APPROVAL_RESOLVED': 'Aprobación resuelta',
  'AUTH.CUSTOMER_MAGIC_LINK': 'Enlace de acceso de cliente',
  'AUTH.EMPLOYEE_PASSWORD_RESET': 'Recuperación de contraseña',
  'AUTH.EMPLOYEE_INVITATION': 'Invitación al equipo',
};

export function templateLabel(key: string): string {
  return TEMPLATE_LABELS[key] ?? key.replace(/[._]/gu, ' ');
}

export function eventLabel(key: string): string {
  return EVENT_LABELS[key] ?? key.replace(/[._]/gu, ' ').toLowerCase();
}

export const ERROR_LABELS: Record<string, string> = {
  TEMPORARY_PROVIDER: 'Proveedor temporal',
  RATE_LIMIT: 'Límite del proveedor',
  INVALID_RECIPIENT: 'Destinatario inválido',
  TEMPLATE_ERROR: 'Plantilla inválida',
  CONFIGURATION: 'Configuración',
  OTHER: 'Error controlado',
};

export function errorCategoryLabel(value: string | null): string {
  return value ? (ERROR_LABELS[value] ?? 'Error controlado') : 'Sin error';
}
