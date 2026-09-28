// Etapa visible del constructor de cotizaciones y "siguiente paso" explicado en lenguaje de negocio.
// Es sólo presentación: el servidor sigue siendo el dueño de qué transición está permitida; esto
// traduce el estado ya calculado (versión, aprobaciones, permisos) a una guía que responde "¿qué
// hago ahora?" sin que el vendedor tenga que deducirlo de qué botones aparecen.

export type QuoteStageStepState = 'done' | 'current' | 'closed' | 'upcoming';
export type QuoteStageStep = { key: 'draft' | 'review' | 'sent' | 'accepted'; label: string; state: QuoteStageStepState; note?: string };
export type QuoteNextStepTone = 'action' | 'waiting' | 'blocked' | 'done';
/** Dónde está el control que resuelve el paso, para que la guía lleve directo a él ('request': la vista de Solicitudes). */
export type QuoteNextStepTarget = 'price-list' | 'lines' | 'actions' | 'document' | 'request';
export type QuoteNextStep = { title: string; detail: string; tone: QuoteNextStepTone; target?: QuoteNextStepTarget };

export type QuoteStageInput = {
  versionStatus: string | null;
  lineCount: number;
  priceListSelected: boolean;
  approvalNeeded: boolean;
  approvalGranted: boolean;
  approvalRequested: boolean;
  canApprove: boolean;
  canSend: boolean;
  canEdit: boolean;
  projectCreated?: boolean;
  /** Última decisión de gerencia si fue un rechazo (y aún no se vuelve a pedir): su motivo guía a ventas. */
  approvalRejectedReason?: string | null;
  /** Lo que el cliente pidió cambiar de la versión enviada (desde el portal), si lo pidió. */
  changesRequested?: string | null;
  /** La versión enviada ya pasó su vigencia: el cliente no puede aceptarla. */
  publishedExpired?: boolean;
  /** Estado del expediente: cerrado o de vuelta en revisión, la versión nueva no se puede crear aquí todavía. */
  requestStatus?: string | null;
};

const REQUEST_CLOSED_STATUSES = new Set(['RECHAZADA', 'VENCIDA']);
const REQUEST_NOT_BUILDABLE_STATUSES = new Set(['RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA']);

const STEP_LABELS: Record<QuoteStageStep['key'], string> = {
  draft: 'Borrador',
  review: 'Revisión',
  sent: 'Enviada',
  accepted: 'Aceptada',
};

function stageIndex(status: string | null): number {
  if (status === 'EN_REVISION') return 1;
  if (status === 'ENVIADA' || status === 'EN_NEGOCIACION' || status === 'RECHAZADA' || status === 'VENCIDA') return 2;
  if (status === 'ACEPTADA') return 3;
  return 0;
}

export function quoteStageSteps(input: QuoteStageInput): QuoteStageStep[] {
  const index = stageIndex(input.versionStatus);
  const closed = input.versionStatus === 'RECHAZADA' || input.versionStatus === 'VENCIDA';
  const accepted = input.versionStatus === 'ACEPTADA';
  return (['draft', 'review', 'sent', 'accepted'] as const).map((key, position) => {
    let state: QuoteStageStepState = position < index ? 'done' : position === index ? 'current' : 'upcoming';
    if (accepted) state = 'done';
    if (closed && position === index) state = 'closed';
    let note: string | undefined;
    if (key === 'review' && input.approvalNeeded) note = input.approvalGranted ? 'Aprobada' : input.approvalRequested ? 'En aprobación' : input.approvalRejectedReason !== undefined && input.approvalRejectedReason !== null ? 'Rechazada por gerencia' : 'Requiere aprobación';
    if (key === 'sent') {
      if (input.versionStatus === 'EN_NEGOCIACION') note = 'En negociación';
      if ((input.versionStatus === 'ENVIADA' || input.versionStatus === 'EN_NEGOCIACION') && input.publishedExpired) note = 'Vencida';
      if (input.versionStatus === 'RECHAZADA') note = 'Rechazada';
      if (input.versionStatus === 'VENCIDA') note = 'Vencida';
    }
    return { key, label: STEP_LABELS[key], state, ...(note ? { note } : {}) };
  });
}

export function quoteNextStep(input: QuoteStageInput): QuoteNextStep {
  const status = input.versionStatus;
  // El expediente manda sobre la versión: cerrado, o reabierto y todavía en revisión, la salida está en
  // Solicitudes (antes el constructor ofrecía "Crear nueva versión" y el servidor lo rechazaba).
  if (status !== 'ACEPTADA' && input.requestStatus && REQUEST_CLOSED_STATUSES.has(input.requestStatus)) {
    return { title: 'Expediente cerrado', detail: 'Para retomarlo, reábrelo desde Solicitudes: vuelve a elaboración y aquí podrás crear la nueva versión.', tone: 'blocked', target: 'request' };
  }
  if (status !== null && status !== 'BORRADOR' && status !== 'EN_REVISION' && status !== 'ACEPTADA' && input.requestStatus && REQUEST_NOT_BUILDABLE_STATUSES.has(input.requestStatus)) {
    return { title: 'El expediente está en revisión', detail: 'Pásalo a elaboración desde Solicitudes para crear la nueva versión de la propuesta.', tone: 'blocked', target: 'request' };
  }
  if (!status || status === 'BORRADOR') {
    if (!input.canEdit) return { title: 'Sólo lectura', detail: 'Tu perfil puede consultar esta propuesta, pero no editarla.', tone: 'waiting' };
    if (!input.priceListSelected) return { title: 'Elige una lista de precios', detail: 'Define la lista con la que se calcularán los precios base antes de agregar conceptos.', tone: 'action', target: 'price-list' };
    if (input.lineCount === 0) return { title: 'Agrega los conceptos', detail: 'Busca en el catálogo por nombre o clave, o agrega un concepto especial. El borrador se guarda solo.', tone: 'action', target: 'lines' };
    return { title: 'Pasa la versión a revisión', detail: 'Cuando la propuesta esté completa, usa «Pasar a revisión». Si algo falta, podrás regresarla a borrador.', tone: 'action', target: 'actions' };
  }
  if (status === 'EN_REVISION') {
    if (input.approvalNeeded && !input.approvalGranted) {
      if (!input.approvalRequested && input.approvalRejectedReason !== undefined && input.approvalRejectedReason !== null) {
        // Sin el punto final del motivo: «…10%». y no «…10%.».
        const reason = input.approvalRejectedReason.trim().replace(/[.\s]+$/u, '');
        return { title: 'Gerencia rechazó la aprobación', detail: reason ? `Motivo: «${reason}». Ajusta la propuesta (regrésala a borrador) o vuelve a solicitarla explicando por qué.` : 'Ajusta la propuesta (regrésala a borrador) o vuelve a solicitarla explicando por qué.', tone: 'blocked', target: 'actions' };
      }
      if (!input.approvalRequested) return { title: 'Solicita la aprobación', detail: 'Esta versión lleva descuento o conceptos especiales: gerencia debe autorizarla antes de enviarla al cliente.', tone: 'blocked', target: 'actions' };
      if (input.canApprove) return { title: 'Decide la aprobación', detail: 'Revisa el descuento o el concepto especial y apruébalo o recházalo con un motivo.', tone: 'action', target: 'actions' };
      return { title: 'Esperando aprobación', detail: 'Gerencia ya recibió la solicitud. En cuanto decida podrás enviar la cotización.', tone: 'waiting' };
    }
    if (input.canSend) return { title: 'Envía la cotización', detail: 'Todo listo: confirma destinatario, total y vigencia, y publícala para el cliente.', tone: 'action', target: 'actions' };
    return { title: 'Lista para enviar', detail: 'Un perfil con permiso de envío puede publicarla para el cliente.', tone: 'waiting' };
  }
  if ((status === 'ENVIADA' || status === 'EN_NEGOCIACION') && input.changesRequested !== undefined && input.changesRequested !== null) {
    const asked = input.changesRequested.trim().replace(/[.\s]+$/u, '');
    return { title: 'El cliente pidió cambios', detail: asked ? `«${asked}». Crea una nueva versión con los ajustes; la actual sigue disponible para el cliente mientras tanto.` : 'Crea una nueva versión con los ajustes; la actual sigue disponible para el cliente mientras tanto.', tone: 'action', target: 'actions' };
  }
  if ((status === 'ENVIADA' || status === 'EN_NEGOCIACION') && input.publishedExpired) {
    return { title: 'La propuesta venció', detail: 'El cliente ya no puede aceptarla. Crea una nueva versión con vigencia actualizada y envíasela.', tone: 'blocked', target: 'actions' };
  }
  if (status === 'ENVIADA' || status === 'EN_NEGOCIACION') {
    return { title: 'Esperando al cliente', detail: 'El cliente puede aceptarla o pedir cambios desde su portal. Si pide cambios, crea una nueva versión.', tone: 'waiting' };
  }
  if (status === 'ACEPTADA') {
    return input.projectCreated
      ? { title: 'Proyecto en marcha', detail: 'El arranque sigue en Proyectos: responsable, checklist y contacto del cliente.', tone: 'done', target: 'document' }
      : { title: 'Convierte en proyecto', detail: 'El cliente aceptó esta versión. Conviértela en proyecto para arrancar; queda a cargo de quien lleva el expediente.', tone: 'action', target: 'document' };
  }
  if (status === 'RECHAZADA') return { title: 'Versión rechazada', detail: 'Crea una nueva versión para retomar la negociación con el cliente.', tone: 'blocked', target: 'actions' };
  if (status === 'VENCIDA') return { title: 'Versión vencida', detail: 'Crea una nueva versión con una vigencia actualizada.', tone: 'blocked', target: 'actions' };
  return { title: 'Sin acción pendiente', detail: 'No hay un siguiente paso para esta versión.', tone: 'done' };
}
