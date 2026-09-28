// Seguimiento de etapas y "tu siguiente paso" del portal de cliente. Traduce el estado interno del
// expediente a las cinco etapas que el cliente reconoce y a una sola indicación accionable, para que
// nunca tenga que adivinar si la pelota está de su lado o del nuestro.

import { QUOTE_REQUEST_STATUS_CUSTOMER_LABELS } from '@/lib/labels';

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

/** Estado del expediente en el idioma del cliente (diccionario canónico en labels.ts). */
export function portalStatusLabel(status: string): string {
  return (QUOTE_REQUEST_STATUS_CUSTOMER_LABELS as Record<string, string>)[status] ?? status;
}

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

export function portalNextStep(input: { status: string; hasQuote: boolean; quoteExpired: boolean; quoteAccepted: boolean; quoteActionable: boolean; changesRequested?: boolean }): PortalNextStep {
  const { status, hasQuote, quoteExpired, quoteAccepted, quoteActionable, changesRequested = false } = input;
  if (status === 'CONVERTIDA_EN_PROYECTO') return { title: 'Tu proyecto está en marcha', detail: 'El equipo ya prepara el arranque. Cualquier duda, escríbenos en la conversación.', target: 'conversation', cta: 'Escribir al equipo', owner: 'done' };
  if (quoteAccepted || status === 'ACEPTADA') return { title: 'Aceptaste la propuesta', detail: 'Gracias. Estamos preparando el arranque de tu proyecto y te avisaremos del siguiente paso.', target: null, owner: 'team' };
  // Expediente cerrado: va antes que la propuesta, porque una versión retirada también puede tener su
  // vigencia vencida y lo que el cliente necesita saber es que el expediente se cerró y cómo retomarlo.
  if (status === 'RECHAZADA') return { title: 'Este expediente se cerró', detail: 'Si quieres retomarlo, escríbenos en la conversación y lo reabrimos contigo.', target: 'conversation', cta: 'Escribir al equipo', owner: 'customer' };
  if (status === 'INFORMACION_REQUERIDA') return { title: 'Necesitamos algunos datos', detail: 'Revisa el mensaje del equipo y responde en la conversación para que podamos avanzar.', target: 'conversation', cta: 'Ir a la conversación', owner: 'customer' };
  // VENCIDA (estado heredado) significa "la propuesta enviada venció", aunque su fecha diga otra cosa.
  if (hasQuote && (quoteExpired || status === 'VENCIDA')) return { title: 'Tu propuesta venció', detail: 'Solicita una versión actualizada y el equipo la preparará para ti.', target: 'quote', cta: 'Ver propuesta', owner: 'customer' };
  // Ya pidió cambios a la versión vigente: la pelota está del lado del equipo (antes se le seguía
  // diciendo "tu propuesta está lista" como si no hubiera hecho nada).
  if (hasQuote && quoteActionable && changesRequested) return { title: 'Pediste cambios a tu propuesta', detail: 'Tu equipo prepara una nueva versión y te avisaremos por correo en cuanto esté lista. Mientras tanto, la actual sigue disponible por si decides aceptarla.', target: 'conversation', cta: 'Ver conversación', owner: 'team' };
  if (hasQuote && quoteActionable) return { title: 'Tu propuesta está lista', detail: 'Revísala con calma: puedes aceptarla o pedir cambios desde aquí mismo.', target: 'quote', cta: 'Revisar propuesta', owner: 'customer' };
  return { title: 'Estamos preparando tu propuesta', detail: 'El equipo está revisando tu proyecto. Te avisaremos por correo en cuanto haya novedades.', target: null, owner: 'team' };
}
