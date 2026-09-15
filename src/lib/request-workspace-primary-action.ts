import type { QuoteRequestStatus } from '@/server/modules/quote-requests/domain';

export type RequestWorkspacePrimaryAction =
  | { key: 'request.take'; kind: 'take'; label: 'Tomar solicitud'; description: string }
  | { key: 'request.information'; kind: 'information'; label: 'Solicitar información'; description: string }
  | { key: `request.status:${QuoteRequestStatus}`; kind: 'status'; targetStatus: QuoteRequestStatus; label: string; description: string }
  | { key: 'quote.open'; kind: 'quote'; label: 'Abrir constructor'; description: string };

type PrimaryActionInput = {
  availableActions: readonly string[];
  availableStatusTransitions: readonly QuoteRequestStatus[];
  hasMissingInformation: boolean;
  capabilities: {
    requestsAssign: boolean;
    requestsStatusUpdate: boolean;
    messagingSend: boolean;
  };
};

const STATUS_ACTION_LABELS: Record<QuoteRequestStatus, string> = {
  RECIBIDA: 'Mantener recibida',
  EN_REVISION: 'Marcar en revisión',
  INFORMACION_REQUERIDA: 'Solicitar información',
  EN_ELABORACION: 'Lista para cotizar',
  COTIZACION_DISPONIBLE: 'Publicar cotización',
  EN_NEGOCIACION: 'Pasar a negociación',
  PENDIENTE_DE_APROBACION: 'Solicitar aprobación',
  ACEPTADA: 'Marcar aceptada',
  RECHAZADA: 'Rechazar solicitud',
  VENCIDA: 'Marcar vencida',
  CONVERTIDA_EN_PROYECTO: 'Convertir en proyecto',
};

const STATUS_ACTION_DESCRIPTIONS: Record<QuoteRequestStatus, string> = {
  RECIBIDA: 'Conserva la solicitud en recepción.',
  EN_REVISION: 'Indica que el equipo ya está revisando el expediente.',
  INFORMACION_REQUERIDA: 'Pide al cliente los datos que faltan.',
  EN_ELABORACION: 'Deja el expediente listo para preparar una cotización.',
  COTIZACION_DISPONIBLE: 'Marca la cotización como disponible para el cliente.',
  EN_NEGOCIACION: 'Registra que la propuesta está en negociación.',
  PENDIENTE_DE_APROBACION: 'Envía la propuesta al siguiente paso de aprobación.',
  ACEPTADA: 'Registra la aceptación de la propuesta.',
  RECHAZADA: 'Cierra la solicitud como rechazada.',
  VENCIDA: 'Marca la propuesta como vencida.',
  CONVERTIDA_EN_PROYECTO: 'Convierte la solicitud en proyecto.',
};

export function getRequestWorkspacePrimaryAction(input: PrimaryActionInput): RequestWorkspacePrimaryAction | null {
  const { availableActions, availableStatusTransitions, hasMissingInformation, capabilities } = input;
  const actionSet = new Set(availableActions);

  if (capabilities.requestsAssign && actionSet.has('request.take')) {
    return { key: 'request.take', kind: 'take', label: 'Tomar solicitud', description: 'Hazte responsable del expediente para comenzar la revisión.' };
  }

  if (capabilities.requestsStatusUpdate && capabilities.messagingSend && hasMissingInformation && actionSet.has('request.information')) {
    return { key: 'request.information', kind: 'information', label: 'Solicitar información', description: 'Pide al cliente los datos que faltan para avanzar.' };
  }

  const nextStatus = availableStatusTransitions[0];
  if (capabilities.requestsStatusUpdate && nextStatus) {
    return { key: `request.status:${nextStatus}`, kind: 'status', targetStatus: nextStatus, label: STATUS_ACTION_LABELS[nextStatus], description: STATUS_ACTION_DESCRIPTIONS[nextStatus] };
  }

  if (actionSet.has('quote.open')) {
    return { key: 'quote.open', kind: 'quote', label: 'Abrir constructor', description: 'Continúa la propuesta comercial desde el constructor.' };
  }

  if (capabilities.requestsStatusUpdate && capabilities.messagingSend && actionSet.has('request.information')) {
    return { key: 'request.information', kind: 'information', label: 'Solicitar información', description: 'Envía una solicitud de información al cliente.' };
  }

  return null;
}

export function requestWorkspaceStatusActionLabel(status: QuoteRequestStatus): string {
  return STATUS_ACTION_LABELS[status];
}
