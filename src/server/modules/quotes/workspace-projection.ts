import type { QuoteRequestStatus } from '@/server/modules/quote-requests/domain';
import type { QuoteVersionStatus } from '@/server/modules/quotes/domain';
import { hasPermission } from '@/server/auth/permissions';

/**
 * Bridge resolver — NOT the ADR-approved target contract.
 *
 * docs/adr/2026-09-10-commercial-lifecycle-v2.md and tests/fixtures/commercial-workflow-v2.ts
 * define the resolver D1/D2 will eventually implement, against a model this schema does not
 * have yet (QuotePublication, QuoteVersion.revision/contentDigest, a LISTA_PARA_COTIZAR request
 * status). This module derives an equivalent projection from today's real schema
 * (Quote.workingVersionId/publishedVersionId + the existing QuoteVersionStatus values) so the
 * ad-hoc client-side status/permission computation it replaces stops shipping today. It is a
 * deliberate, scoped bridge: when D1 lands the target model, this file is replaced wholesale,
 * not extended.
 */

export const WORKSPACE_STAGES = [
  'NUEVA_SOLICITUD',
  'EN_REVISION',
  'ESPERANDO_CLIENTE',
  'RESPUESTA_RECIBIDA',
  'PREPARAR_PROPUESTA',
  'BORRADOR_GUARDADO',
  'ESPERANDO_APROBACION',
  'PREPARAR_DOCUMENTO',
  'PREPARANDO_DOCUMENTO',
  'DOCUMENTO_REQUIERE_ATENCION',
  'LISTA_PARA_PUBLICAR',
  'PROPUESTA_PUBLICADA',
  'AVISO_FALLIDO',
  'ESPERANDO_DECISION',
  'CAMBIOS_SOLICITADOS',
  'REVISANDO_CAMBIOS',
  'PROPUESTA_VENCIDA',
  'ACEPTADA',
  'PROPUESTA_RECHAZADA',
  'SOLICITUD_RECHAZADA',
  'SOLICITUD_CONVERTIDA',
] as const;
export type WorkspaceStage = (typeof WORKSPACE_STAGES)[number];

const STAGE_LABELS: Record<WorkspaceStage, string> = {
  NUEVA_SOLICITUD: 'Nueva solicitud',
  EN_REVISION: 'En revisión',
  ESPERANDO_CLIENTE: 'Esperando al cliente',
  RESPUESTA_RECIBIDA: 'Respuesta recibida',
  PREPARAR_PROPUESTA: 'Preparar propuesta',
  BORRADOR_GUARDADO: 'Borrador guardado',
  ESPERANDO_APROBACION: 'Esperando aprobación',
  PREPARAR_DOCUMENTO: 'Preparar documento',
  PREPARANDO_DOCUMENTO: 'Preparando documento',
  DOCUMENTO_REQUIERE_ATENCION: 'Documento requiere atención',
  LISTA_PARA_PUBLICAR: 'Lista para publicar',
  PROPUESTA_PUBLICADA: 'Propuesta publicada',
  AVISO_FALLIDO: 'Aviso fallido',
  ESPERANDO_DECISION: 'Esperando decisión del cliente',
  CAMBIOS_SOLICITADOS: 'Cambios solicitados',
  REVISANDO_CAMBIOS: 'Revisando cambios',
  PROPUESTA_VENCIDA: 'Propuesta vencida',
  ACEPTADA: 'Aceptada',
  PROPUESTA_RECHAZADA: 'Propuesta rechazada',
  SOLICITUD_RECHAZADA: 'Solicitud rechazada',
  SOLICITUD_CONVERTIDA: 'Convertida en proyecto',
};

export const WORKSPACE_ACTORS = ['STAFF', 'MANAGER', 'CUSTOMER', 'SYSTEM', 'NONE'] as const;
export type WorkspaceActor = (typeof WORKSPACE_ACTORS)[number];

export const WORKSPACE_ACTIONS = [
  'REQUEST_CLAIM',
  'REQUEST_COMPLETE_REVIEW',
  'REQUEST_ASK_INFORMATION',
  'REQUEST_REVIEW_RESPONSE',
  'REQUEST_REMIND_CUSTOMER',
  'QUOTE_ADD_FIRST_LINE',
  'QUOTE_SUBMIT_FOR_REVIEW',
  'QUOTE_RESOLVE_APPROVAL',
  'QUOTE_RETRY_DOCUMENT',
  'QUOTE_PUBLISH',
  'QUOTE_RETRY_DELIVERY',
  'QUOTE_CREATE_REVISION',
  'QUOTE_CLONE_EXPIRED',
] as const;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

const ACTION_PERMISSION_REQUIREMENTS: Record<WorkspaceAction, string> = {
  REQUEST_CLAIM: 'requests.assign',
  REQUEST_COMPLETE_REVIEW: 'requests.status.update',
  REQUEST_ASK_INFORMATION: 'messaging.send',
  REQUEST_REVIEW_RESPONSE: 'requests.status.update',
  REQUEST_REMIND_CUSTOMER: 'messaging.send',
  QUOTE_ADD_FIRST_LINE: 'quotes.create',
  QUOTE_SUBMIT_FOR_REVIEW: 'quotes.create',
  QUOTE_RESOLVE_APPROVAL: 'quotes.approve_discount',
  QUOTE_RETRY_DOCUMENT: 'quotes.pdf.generate',
  QUOTE_PUBLISH: 'quotes.send',
  QUOTE_RETRY_DELIVERY: 'notifications.manage',
  QUOTE_CREATE_REVISION: 'quotes.create',
  QUOTE_CLONE_EXPIRED: 'quotes.create',
};

export const WORKSPACE_BLOCKERS = [
  'MESSAGE_REQUIRED',
  'DOCUMENT_NOT_READY',
  'SEPARATION_OF_DUTIES',
  'APPROVAL_REQUIRED',
  'PROJECT_CONTRACT_MISSING',
] as const;
export type WorkspaceBlocker = (typeof WORKSPACE_BLOCKERS)[number];

export const DOCUMENT_STATES = ['NOT_CREATED', 'PENDING', 'READY', 'FAILED'] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export const DELIVERY_STATES = ['NONE', 'PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export type WorkspaceRequestInput = Readonly<{
  status: QuoteRequestStatus;
  currentAssigneeId: string | null;
  updatedAt: Date;
}>;

export type WorkspaceConversationInput = Readonly<{
  lastMessageFromCustomer: boolean;
}>;

export type WorkspaceApprovalStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'SUPERSEDED';

export type WorkspaceApprovalInput = Readonly<{
  status: WorkspaceApprovalStatus;
  requestedById: string;
  requestedAt: Date;
}>;

export type WorkspaceVersionInput = Readonly<{
  id: string;
  versionNumber: number;
  status: QuoteVersionStatus;
  validUntil: Date | null;
  updatedAt: Date;
  approvals: readonly WorkspaceApprovalInput[];
}>;

export type WorkspaceActorCapabilities = Readonly<{
  userId: string;
  permissionKeys: ReadonlySet<string>;
}>;

export type QuoteWorkspaceProjectionInput = Readonly<{
  request: WorkspaceRequestInput;
  workingVersion: WorkspaceVersionInput | null;
  publishedVersion: WorkspaceVersionInput | null;
  document: Readonly<{ state: DocumentState }> | null;
  delivery: Readonly<{ state: DeliveryState; retryable: boolean; updatedAt: Date }> | null;
  conversation: WorkspaceConversationInput;
  /** Project does not exist as a model yet — always null in this slice. */
  project: null;
  actor: WorkspaceActorCapabilities;
  now: Date;
}>;

export type WorkspaceVersionSummary = Readonly<{
  id: string;
  versionNumber: number;
  status: QuoteVersionStatus;
  validUntil: Date | null;
}>;

export type QuoteWorkspaceProjection = Readonly<{
  stage: WorkspaceStage;
  stageLabel: string;
  actorExpected: WorkspaceActor;
  waitingSince: Date | null;
  primaryAction: WorkspaceAction | null;
  secondaryActions: readonly WorkspaceAction[];
  blockers: readonly WorkspaceBlocker[];
  workingVersion: WorkspaceVersionSummary | null;
  publishedVersion: WorkspaceVersionSummary | null;
  documentStatus: DocumentState;
  deliveryStatus: DeliveryState;
}>;

type ProjectionPartial = Readonly<{
  stage: WorkspaceStage;
  actorExpected: WorkspaceActor;
  waitingSince: Date | null;
  primaryAction: WorkspaceAction | null;
  secondaryActions?: readonly WorkspaceAction[];
  blockers?: readonly WorkspaceBlocker[];
}>;

function toVersionSummary(version: WorkspaceVersionInput | null): WorkspaceVersionSummary | null {
  if (!version) return null;
  return { id: version.id, versionNumber: version.versionNumber, status: version.status, validUntil: version.validUntil };
}

function gateAction(action: WorkspaceAction | null, actor: WorkspaceActorCapabilities): WorkspaceAction | null {
  if (!action) return null;
  return hasPermission(actor, ACTION_PERMISSION_REQUIREMENTS[action]) ? action : null;
}

function gateActions(actions: readonly WorkspaceAction[], actor: WorkspaceActorCapabilities): readonly WorkspaceAction[] {
  return actions.filter((action) => hasPermission(actor, ACTION_PERMISSION_REQUIREMENTS[action]));
}

function finalize(input: QuoteWorkspaceProjectionInput, partial: ProjectionPartial): QuoteWorkspaceProjection {
  return {
    stage: partial.stage,
    stageLabel: STAGE_LABELS[partial.stage],
    actorExpected: partial.actorExpected,
    waitingSince: partial.waitingSince,
    primaryAction: gateAction(partial.primaryAction, input.actor),
    secondaryActions: gateActions(partial.secondaryActions ?? [], input.actor),
    blockers: partial.blockers ?? [],
    workingVersion: toVersionSummary(input.workingVersion),
    publishedVersion: toVersionSummary(input.publishedVersion),
    documentStatus: input.document?.state ?? 'NOT_CREATED',
    deliveryStatus: input.delivery?.state ?? 'NONE',
  };
}

function isExpired(version: WorkspaceVersionInput, now: Date): boolean {
  return version.status === 'VENCIDA' || (version.validUntil !== null && version.validUntil.getTime() < now.getTime());
}

function resolveRequestOnlyStage(request: WorkspaceRequestInput, conversation: WorkspaceConversationInput): ProjectionPartial | null {
  if (request.status === 'RECIBIDA') {
    return { stage: 'NUEVA_SOLICITUD', actorExpected: 'STAFF', waitingSince: request.updatedAt, primaryAction: request.currentAssigneeId === null ? 'REQUEST_CLAIM' : null };
  }
  if (request.status === 'EN_REVISION') {
    return { stage: 'EN_REVISION', actorExpected: 'STAFF', waitingSince: request.updatedAt, primaryAction: 'REQUEST_COMPLETE_REVIEW', secondaryActions: ['REQUEST_ASK_INFORMATION'] };
  }
  if (request.status === 'INFORMACION_REQUERIDA') {
    if (conversation.lastMessageFromCustomer) {
      return { stage: 'RESPUESTA_RECIBIDA', actorExpected: 'STAFF', waitingSince: request.updatedAt, primaryAction: 'REQUEST_REVIEW_RESPONSE' };
    }
    return { stage: 'ESPERANDO_CLIENTE', actorExpected: 'CUSTOMER', waitingSince: request.updatedAt, primaryAction: null, secondaryActions: ['REQUEST_REMIND_CUSTOMER'] };
  }
  if (request.status === 'EN_ELABORACION' || request.status === 'COTIZACION_DISPONIBLE' || request.status === 'EN_NEGOCIACION') {
    return { stage: 'PREPARAR_PROPUESTA', actorExpected: 'STAFF', waitingSince: request.updatedAt, primaryAction: 'QUOTE_ADD_FIRST_LINE' };
  }
  if (request.status === 'RECHAZADA') {
    return { stage: 'SOLICITUD_RECHAZADA', actorExpected: 'NONE', waitingSince: request.updatedAt, primaryAction: null };
  }
  return null;
}

function resolveWorkingVersionSubStage(
  version: WorkspaceVersionInput,
  document: QuoteWorkspaceProjectionInput['document'],
  actor: WorkspaceActorCapabilities,
): ProjectionPartial {
  if (version.status === 'BORRADOR') {
    return { stage: 'BORRADOR_GUARDADO', actorExpected: 'STAFF', waitingSince: version.updatedAt, primaryAction: 'QUOTE_SUBMIT_FOR_REVIEW' };
  }

  // EN_REVISION: a pending approval of any type blocks sending, regardless of document state.
  const pendingApproval = version.approvals.find((approval) => approval.status === 'REQUESTED');
  if (pendingApproval) {
    const separationBlocked = pendingApproval.requestedById === actor.userId;
    return {
      stage: 'ESPERANDO_APROBACION',
      actorExpected: 'MANAGER',
      waitingSince: pendingApproval.requestedAt,
      primaryAction: separationBlocked ? null : 'QUOTE_RESOLVE_APPROVAL',
      blockers: separationBlocked ? ['SEPARATION_OF_DUTIES'] : [],
    };
  }

  const documentState = document?.state ?? 'NOT_CREATED';
  if (documentState === 'NOT_CREATED') {
    // generateQuotePdf handles both first generation and FAILED retry with the same command.
    return { stage: 'PREPARAR_DOCUMENTO', actorExpected: 'STAFF', waitingSince: version.updatedAt, primaryAction: 'QUOTE_RETRY_DOCUMENT' };
  }
  if (documentState === 'PENDING') {
    // generateQuotePdf 409s while a document is already PENDING — no safe retry action to offer.
    return { stage: 'PREPARANDO_DOCUMENTO', actorExpected: 'SYSTEM', waitingSince: version.updatedAt, primaryAction: null, blockers: ['DOCUMENT_NOT_READY'] };
  }
  if (documentState === 'FAILED') {
    return { stage: 'DOCUMENTO_REQUIERE_ATENCION', actorExpected: 'STAFF', waitingSince: version.updatedAt, primaryAction: 'QUOTE_RETRY_DOCUMENT' };
  }
  return { stage: 'LISTA_PARA_PUBLICAR', actorExpected: 'STAFF', waitingSince: version.updatedAt, primaryAction: 'QUOTE_PUBLISH' };
}

export function resolveQuoteWorkspaceProjection(input: QuoteWorkspaceProjectionInput): QuoteWorkspaceProjection {
  const { request, workingVersion, publishedVersion, conversation, document, delivery, now } = input;

  if (request.status === 'CONVERTIDA_EN_PROYECTO') {
    return finalize(input, { stage: 'SOLICITUD_CONVERTIDA', actorExpected: 'STAFF', waitingSince: request.updatedAt, primaryAction: null });
  }

  if (workingVersion === null && publishedVersion === null) {
    // request.status RECHAZADA/VENCIDA are intentionally not special-cased above this point:
    // VENCIDA is a legacy copy of "the published version expired" (ADR: expiry never blocks a
    // new working version) and RECHAZADA can mean either "request rejected before any quote"
    // (handled below) or a legacy copy of "customer rejected the published quote" (handled by
    // the published-version branch further down, which is more specific and useful).
    const partial = resolveRequestOnlyStage(request, conversation);
    if (!partial) throw new Error('Unclassified quote workspace projection combination — extend resolveQuoteWorkspaceProjection.');
    return finalize(input, partial);
  }

  const workingSubStage = workingVersion ? resolveWorkingVersionSubStage(workingVersion, document, input.actor) : null;

  if (publishedVersion !== null) {
    if (workingVersion !== null) {
      // A new working version never removes the last published version (non-negotiable invariant).
      return finalize(input, { ...workingSubStage!, stage: 'REVISANDO_CAMBIOS' });
    }
    if (publishedVersion.status === 'ACEPTADA') {
      return finalize(input, { stage: 'ACEPTADA', actorExpected: 'STAFF', waitingSince: publishedVersion.updatedAt, primaryAction: null, blockers: ['PROJECT_CONTRACT_MISSING'] });
    }
    if (publishedVersion.status === 'RECHAZADA') {
      return finalize(input, { stage: 'PROPUESTA_RECHAZADA', actorExpected: 'STAFF', waitingSince: publishedVersion.updatedAt, primaryAction: null });
    }
    if (isExpired(publishedVersion, now)) {
      return finalize(input, { stage: 'PROPUESTA_VENCIDA', actorExpected: 'STAFF', waitingSince: publishedVersion.updatedAt, primaryAction: 'QUOTE_CLONE_EXPIRED' });
    }
    if (publishedVersion.status !== 'ENVIADA' && publishedVersion.status !== 'EN_NEGOCIACION') {
      throw new Error('Unclassified quote workspace projection combination — extend resolveQuoteWorkspaceProjection.');
    }
    if (conversation.lastMessageFromCustomer) {
      return finalize(input, { stage: 'CAMBIOS_SOLICITADOS', actorExpected: 'STAFF', waitingSince: publishedVersion.updatedAt, primaryAction: 'QUOTE_CREATE_REVISION' });
    }
    const deliveryState = delivery?.state ?? 'NONE';
    if (deliveryState === 'FAILED') {
      return finalize(input, {
        stage: 'AVISO_FALLIDO',
        actorExpected: 'STAFF',
        waitingSince: delivery?.updatedAt ?? publishedVersion.updatedAt,
        primaryAction: delivery?.retryable ? 'QUOTE_RETRY_DELIVERY' : null,
      });
    }
    if (deliveryState === 'SENT') {
      return finalize(input, { stage: 'ESPERANDO_DECISION', actorExpected: 'CUSTOMER', waitingSince: delivery?.updatedAt ?? publishedVersion.updatedAt, primaryAction: null });
    }
    return finalize(input, { stage: 'PROPUESTA_PUBLICADA', actorExpected: 'SYSTEM', waitingSince: delivery?.updatedAt ?? publishedVersion.updatedAt, primaryAction: null });
  }

  if (workingSubStage) return finalize(input, workingSubStage);

  throw new Error('Unclassified quote workspace projection combination — extend resolveQuoteWorkspaceProjection.');
}
