// Seguimiento de etapas y "tu siguiente paso" del portal de cliente. Traduce el estado interno del
// expediente a las cinco etapas que el cliente reconoce y a una sola indicación accionable, para que
// nunca tenga que adivinar si la pelota está de su lado o del nuestro.

export type PortalStageState = 'done' | 'current' | 'closed' | 'upcoming';
export type PortalStage = { key: string; label: string; state: PortalStageState };
export type PortalNextStep = {
  title: string;
  detail: string;
  /** Dónde está la acción: la propuesta, la conversación, o nada que hacer (esperando al equipo). */
  target: 'quote' | 'conversation' | null;
  cta?: string;
  owner: 'customer' | 'team' | 'done';
};

const STAGES = [
  { key: 'received', label: 'Solicitud recibida' },
  { key: 'review', label: 'En revisión' },
  { key: 'proposal', label: 'Propuesta' },
  { key: 'accepted', label: 'Aceptada' },
  { key: 'project', label: 'Proyecto' },
] as const;

function stageIndex(status: string): number {
  if (status === 'RECIBIDA') return 0;
  if (status === 'EN_REVISION' || status === 'INFORMACION_REQUERIDA' || status === 'EN_ELABORACION') return 1;
  if (status === 'COTIZACION_DISPONIBLE' || status === 'EN_NEGOCIACION' || status === 'PENDIENTE_DE_APROBACION' || status === 'RECHAZADA' || status === 'VENCIDA') return 2;
  if (status === 'ACEPTADA') return 3;
  if (status === 'CONVERTIDA_EN_PROYECTO') return 4;
  return 0;
}

export function portalStages(status: string): PortalStage[] {
  const index = stageIndex(status);
  const closed = status === 'RECHAZADA' || status === 'VENCIDA';
  const finished = status === 'CONVERTIDA_EN_PROYECTO';
  return STAGES.map((stage, position) => ({
    ...stage,
    state: finished || position < index ? 'done' : position === index ? (closed ? 'closed' : 'current') : 'upcoming',
  }));
}

export function portalNextStep(input: { status: string; hasQuote: boolean; quoteExpired: boolean; quoteAccepted: boolean; quoteActionable: boolean }): PortalNextStep {
  const { status, hasQuote, quoteExpired, quoteAccepted, quoteActionable } = input;
  if (status === 'CONVERTIDA_EN_PROYECTO') return { title: 'Tu proyecto está en marcha', detail: 'El equipo ya prepara el arranque. Cualquier duda, escríbenos en la conversación.', target: 'conversation', cta: 'Escribir al equipo', owner: 'done' };
  if (quoteAccepted || status === 'ACEPTADA') return { title: 'Aceptaste la propuesta', detail: 'Gracias. Estamos preparando el arranque de tu proyecto y te avisaremos del siguiente paso.', target: null, owner: 'team' };
  if (status === 'INFORMACION_REQUERIDA') return { title: 'Necesitamos algunos datos', detail: 'Revisa el mensaje del equipo y responde en la conversación para que podamos avanzar.', target: 'conversation', cta: 'Ir a la conversación', owner: 'customer' };
  if (hasQuote && quoteExpired) return { title: 'Tu propuesta venció', detail: 'Solicita una versión actualizada y el equipo la preparará para ti.', target: 'quote', cta: 'Ver propuesta', owner: 'customer' };
  if (hasQuote && quoteActionable) return { title: 'Tu propuesta está lista', detail: 'Revísala con calma: puedes aceptarla o pedir cambios desde aquí mismo.', target: 'quote', cta: 'Revisar propuesta', owner: 'customer' };
  if (status === 'RECHAZADA') return { title: 'Esta solicitud se cerró', detail: 'Si quieres retomarla, escríbenos en la conversación.', target: 'conversation', cta: 'Escribir al equipo', owner: 'customer' };
  return { title: 'Estamos preparando tu propuesta', detail: 'El equipo está revisando tu proyecto. Te avisaremos por correo en cuanto haya novedades.', target: null, owner: 'team' };
}
