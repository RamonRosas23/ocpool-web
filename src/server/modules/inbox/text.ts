import type { InboxData, InboxKind } from './kinds';

export type InboxText = Readonly<{ title: string; body: string | null }>;
export type InboxMergeResult = Readonly<{ data: InboxData; changed: boolean }>;

const TITLE_LIMIT = 200;
const BODY_LIMIT = 400;
const APPROVAL_TYPE_LABELS: Readonly<Record<string, string>> = { DISCOUNT: 'descuento', SPECIAL_CONCEPT: 'concepto especial', PRICE_OVERRIDE: 'ajuste de precio' };

function fit(value: string, limit: number): string {
  const flat = value.replace(/\s+/gu, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

function count(value: number | undefined): number {
  return typeof value === 'number' && value > 0 ? value : 0;
}

function quantity(amount: number, one: string, many: string): string {
  return amount === 1 ? one : `${amount} ${many}`;
}

function versionLabel(data: InboxData): string {
  return data.versionNumber ? ` V${data.versionNumber}` : '';
}

function joinParts(parts: ReadonlyArray<string | undefined | null>): string | null {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(' · ') : null;
}

function approvalTypeLabel(data: InboxData): string {
  return APPROVAL_TYPE_LABELS[data.approvalType ?? ''] ?? 'ajuste';
}

export function staffActivityTitle(actor: string, messages: number, files: number): string {
  if (files > 0 && messages > 0) return `${actor} subió ${quantity(files, 'un archivo', 'archivos')} y dejó ${quantity(messages, 'un mensaje', 'mensajes')}`;
  if (files > 0) return `${actor} subió ${quantity(files, 'un archivo', 'archivos')}`;
  return messages > 1 ? `${actor} te escribió ${messages} mensajes` : `${actor} te escribió`;
}

export function teamActivityTitle(messages: number, files: number): string {
  const team = 'El equipo OCPOOL';
  if (files > 0 && messages > 0) return `${team} te escribió ${quantity(messages, 'un mensaje', 'mensajes')} y compartió ${quantity(files, 'un archivo', 'archivos')}`;
  if (files > 0) return `${team} compartió ${quantity(files, 'un archivo', 'archivos')}`;
  return messages > 1 ? `${team} te escribió ${messages} mensajes` : `${team} te escribió`;
}

function pendingPriceBody(data: InboxData): string | null {
  const folios = data.requestFolios ?? [];
  if (folios.length === 0) return null;
  if (folios.length === 1) return `Lo espera ${folios[0]}`;
  return `Lo esperan ${folios.length} propuestas: ${folios.slice(0, 3).join(', ')}${folios.length > 3 ? '…' : ''}`;
}

function draft(kind: InboxKind, data: InboxData): { title: string; body: string | null } {
  const actor = data.actorName ?? 'Alguien del equipo';
  const customer = data.actorName ?? data.clientName ?? 'El cliente';
  const folio = data.folio ?? 'el expediente';
  switch (kind) {
    case 'request.new_unassigned':
      return { title: `Nueva solicitud: ${data.projectType ?? 'proyecto'} en ${data.location ?? 'ubicación por confirmar'}`, body: joinParts([data.clientName, data.folio]) };
    case 'customer.activity':
      return { title: staffActivityTitle(customer, count(data.messages), count(data.files)), body: data.preview ?? null };
    case 'quote.changes_requested':
      return { title: `${customer} pidió cambios a la propuesta${versionLabel(data)}`, body: data.preview ?? null };
    case 'quote.accepted':
      return { title: `${customer} aceptó la propuesta${versionLabel(data)}`, body: data.totalLabel ?? null };
    case 'quote.declined':
      return { title: `${customer} declinó la propuesta${versionLabel(data)}`, body: data.reason ? `Motivo: ${data.reason}.` : null };
    case 'quote.viewed':
      return { title: `${customer} abrió la propuesta${versionLabel(data)}`, body: data.folio ?? null };
    case 'customer.portal_activated':
      return { title: `${customer} activó su portal`, body: data.folio ?? null };
    case 'request.assigned_to_you':
      return { title: `${actor} te asignó ${folio}`, body: joinParts([data.projectType && data.location ? `${data.projectType} en ${data.location}` : data.projectType, data.clientName]) };
    case 'request.unassigned_from_you':
      return { title: data.toName ? `${actor} reasignó ${folio} a ${data.toName}` : `${actor} quitó ${folio} de tu cargo`, body: data.clientName ?? null };
    case 'approval.requested':
      return { title: `${actor} pide aprobar un ${approvalTypeLabel(data)} en ${folio}`, body: joinParts([data.versionNumber ? `Propuesta V${data.versionNumber}` : undefined, data.clientName]) };
    case 'approval.resolved':
      return data.approvalStatus === 'APPROVED'
        ? { title: `${actor} aprobó tu ${approvalTypeLabel(data)} en ${folio}`, body: `Ya puedes enviar la propuesta${versionLabel(data)}` }
        : { title: `${actor} rechazó tu ${approvalTypeLabel(data)} en ${folio}`, body: data.reason ? `Motivo: ${data.reason}` : null };
    case 'quote.returned':
      return {
        title: data.outcome === 'REJECTED' ? `${actor} rechazó la propuesta${versionLabel(data)} de ${folio}` : `${actor} devolvió a borrador la propuesta${versionLabel(data)} de ${folio}`,
        body: data.reason ? `Motivo: ${data.reason}` : null,
      };
    case 'price.pending':
      return { title: `${data.itemName ?? 'Un concepto'} necesita precio en ${data.priceListName ?? 'su lista'}`, body: pendingPriceBody(data) };
    case 'price.assigned':
      return { title: `${data.itemName ?? 'Un concepto'} ya tiene precio en ${data.priceListName ?? 'su lista'}`, body: data.folio ? `Tu propuesta ${data.folio} puede continuar` : null };
    case 'note.internal':
      return { title: count(data.messages) > 1 ? `${actor} dejó ${count(data.messages)} notas internas en ${folio}` : `${actor} dejó una nota interna en ${folio}`, body: data.preview ?? null };
    case 'project.assigned':
      return { title: `Te asignaron el proyecto ${data.projectFolio ?? ''}`, body: joinParts([data.clientName, data.folio]) };
    case 'project.created':
      return { title: `${actor} creó el proyecto ${data.projectFolio ?? ''}`, body: joinParts([data.clientName, data.ownerName ? `Responsable: ${data.ownerName}` : 'Sin responsable']) };
    case 'team.work_reassigned': {
      const parts = [
        count(data.requestsCount) ? quantity(count(data.requestsCount), 'un expediente', 'expedientes') : undefined,
        count(data.projectsCount) ? quantity(count(data.projectsCount), 'un proyecto', 'proyectos') : undefined,
      ].filter(Boolean).join(' y ');
      return { title: `Recibiste ${parts || 'trabajo'} de ${data.fromName ?? 'otra persona'}`, body: data.actorName ? `Asignado por ${data.actorName}` : null };
    }
    case 'email.delivery_failed':
      return { title: `No se pudo entregar un correo a ${data.clientName ?? 'un cliente'}`, body: joinParts([data.templateLabel, data.folio, 'Revisa el correo del contacto']) };
    case 'request.closed':
      return { title: `${actor} cerró ${folio}`, body: data.reason ? `Motivo: ${data.reason}` : data.clientName ?? null };
    case 'request.reopened':
      return { title: `${actor} reabrió ${folio}`, body: data.clientName ?? null };
    case 'team.activity':
      return { title: teamActivityTitle(count(data.messages), count(data.files)), body: data.preview ?? null };
    case 'request.information_needed':
      return { title: `Necesitamos unos datos para continuar con ${data.projectType ?? 'tu proyecto'}`, body: data.preview ?? null };
    case 'quote.ready':
      return { title: `Tu propuesta${versionLabel(data)} está lista`, body: joinParts([data.totalLabel, data.folio]) };
    case 'project.started':
      return { title: `Tu proyecto ${data.projectFolio ?? ''} arrancó`, body: data.ownerName ? `Tu responsable es ${data.ownerName}` : 'Te contactaremos para coordinar el arranque' };
    case 'request.received':
      return { title: `Recibimos tu solicitud ${data.folio ?? ''}`, body: data.projectType ?? null };
  }
}

export function renderInboxText(kind: InboxKind, data: InboxData): InboxText {
  const text = draft(kind, data);
  return { title: fit(text.title, TITLE_LIMIT), body: text.body ? fit(text.body, BODY_LIMIT) : null };
}

/** Suma la actividad nueva al aviso abierto del mismo grupo. `changed: false` = no hay nada que escribir. */
export function mergeInboxData(kind: InboxKind, previous: InboxData, next: InboxData): InboxMergeResult {
  switch (kind) {
    case 'customer.activity':
    case 'team.activity':
    case 'note.internal':
    case 'quote.changes_requested':
      return { changed: true, data: { ...previous, ...next, messages: count(previous.messages) + count(next.messages), files: count(previous.files) + count(next.files), preview: next.preview ?? previous.preview } };
    case 'price.pending': {
      const requestIds = [...(previous.requestIds ?? [])];
      const requestFolios = [...(previous.requestFolios ?? [])];
      let changed = false;
      (next.requestIds ?? []).forEach((requestId, index) => {
        if (requestIds.includes(requestId)) return;
        requestIds.push(requestId);
        const folio = next.requestFolios?.[index];
        if (folio) requestFolios.push(folio);
        changed = true;
      });
      return { changed, data: { ...previous, requestIds, requestFolios } };
    }
    default:
      return { changed: true, data: { ...previous, ...next } };
  }
}

export function inboxOccurrences(kind: InboxKind, data: InboxData, previous: number): number {
  if (kind === 'price.pending') return Math.max(1, data.requestIds?.length ?? 1);
  return previous + 1;
}
