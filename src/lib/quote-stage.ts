// Etapa visible del constructor de cotizaciones y "siguiente paso" explicado en lenguaje de negocio.
// Es sólo presentación: el servidor sigue siendo el dueño de qué transición está permitida; esto
// traduce el estado ya calculado (versión, aprobaciones, permisos) a una guía que responde "¿qué
// hago ahora?" sin que el vendedor tenga que deducirlo de qué botones aparecen.

export type QuoteStageStepState = 'done' | 'current' | 'closed' | 'upcoming';
export type QuoteStageStep = { key: 'draft' | 'review' | 'sent' | 'accepted'; label: string; state: QuoteStageStepState; note?: string };
export type QuoteNextStepTone = 'action' | 'waiting' | 'blocked' | 'done';
/** Dónde está el control que resuelve el paso, para que la guía lleve directo a él. */
export type QuoteNextStepTarget = 'price-list' | 'lines' | 'actions' | 'document';
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
};

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
    if (key === 'review' && input.approvalNeeded) note = input.approvalGranted ? 'Aprobada' : input.approvalRequested ? 'En aprobación' : 'Requiere aprobación';
    if (key === 'sent') {
      if (input.versionStatus === 'EN_NEGOCIACION') note = 'En negociación';
      if (input.versionStatus === 'RECHAZADA') note = 'Rechazada';
      if (input.versionStatus === 'VENCIDA') note = 'Vencida';
    }
    return { key, label: STEP_LABELS[key], state, ...(note ? { note } : {}) };
  });
}

export function quoteNextStep(input: QuoteStageInput): QuoteNextStep {
  const status = input.versionStatus;
  if (!status || status === 'BORRADOR') {
    if (!input.canEdit) return { title: 'Sólo lectura', detail: 'Tu perfil puede consultar esta propuesta, pero no editarla.', tone: 'waiting' };
    if (!input.priceListSelected) return { title: 'Elige una lista de precios', detail: 'Define la lista con la que se calcularán los precios base antes de agregar conceptos.', tone: 'action', target: 'price-list' };
    if (input.lineCount === 0) return { title: 'Agrega los conceptos', detail: 'Busca en el catálogo por nombre o clave, o agrega un concepto especial. El borrador se guarda solo.', tone: 'action', target: 'lines' };
    return { title: 'Pasa la versión a revisión', detail: 'Cuando la propuesta esté completa, usa «Pasar a revisión». Si algo falta, podrás regresarla a borrador.', tone: 'action', target: 'actions' };
  }
  if (status === 'EN_REVISION') {
    if (input.approvalNeeded && !input.approvalGranted) {
      if (!input.approvalRequested) return { title: 'Solicita la aprobación', detail: 'Esta versión lleva descuento o conceptos especiales: gerencia debe autorizarla antes de enviarla al cliente.', tone: 'blocked', target: 'actions' };
      if (input.canApprove) return { title: 'Decide la aprobación', detail: 'Revisa el descuento o el concepto especial y apruébalo o recházalo con un motivo.', tone: 'action', target: 'actions' };
      return { title: 'Esperando aprobación', detail: 'Gerencia ya recibió la solicitud. En cuanto decida podrás enviar la cotización.', tone: 'waiting' };
    }
    if (input.canSend) return { title: 'Envía la cotización', detail: 'Todo listo: confirma destinatario, total y vigencia, y publícala para el cliente.', tone: 'action', target: 'actions' };
    return { title: 'Lista para enviar', detail: 'Un perfil con permiso de envío puede publicarla para el cliente.', tone: 'waiting' };
  }
  if (status === 'ENVIADA' || status === 'EN_NEGOCIACION') {
    return { title: 'Esperando al cliente', detail: 'El cliente puede aceptarla o pedir cambios desde su portal. Si pide cambios, crea una nueva versión.', tone: 'waiting' };
  }
  if (status === 'ACEPTADA') {
    return input.projectCreated
      ? { title: 'Proyecto en marcha', detail: 'La propuesta aceptada ya tiene su proyecto de arranque.', tone: 'done', target: 'document' }
      : { title: 'Convierte en proyecto', detail: 'El cliente aceptó esta versión. Inicia el handoff desde el documento comercial.', tone: 'action', target: 'document' };
  }
  if (status === 'RECHAZADA') return { title: 'Versión rechazada', detail: 'Crea una nueva versión para retomar la negociación con el cliente.', tone: 'blocked', target: 'actions' };
  if (status === 'VENCIDA') return { title: 'Versión vencida', detail: 'Crea una nueva versión con una vigencia actualizada.', tone: 'blocked', target: 'actions' };
  return { title: 'Sin acción pendiente', detail: 'No hay un siguiente paso para esta versión.', tone: 'done' };
}
