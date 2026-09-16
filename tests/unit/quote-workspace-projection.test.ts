import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_ACTIONS,
  WORKSPACE_STAGES,
  resolveQuoteWorkspaceProjection,
  type QuoteWorkspaceProjectionInput,
  type WorkspaceActorCapabilities,
  type WorkspaceVersionInput,
} from '@/server/modules/quotes/workspace-projection';
import { ACTION_CATALOG, TARGET_STATES } from '../fixtures/commercial-workflow-v2';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const PAST = new Date('2026-09-01T00:00:00.000Z');
const FUTURE = new Date('2026-12-01T00:00:00.000Z');

const ALL_PERMISSIONS = [
  'requests.assign',
  'requests.status.update',
  'messaging.send',
  'quotes.create',
  'quotes.approve_discount',
  'quotes.pdf.generate',
  'quotes.send',
  'notifications.manage',
];

function actorWith(permissions: readonly string[], userId = 'staff-1'): WorkspaceActorCapabilities {
  return { userId, permissionKeys: new Set(permissions) };
}

function version(overrides: Partial<WorkspaceVersionInput> = {}): WorkspaceVersionInput {
  return { id: 'v1', versionNumber: 1, status: 'BORRADOR', validUntil: null, updatedAt: NOW, approvals: [], ...overrides };
}

function baseInput(overrides: Partial<QuoteWorkspaceProjectionInput> = {}): QuoteWorkspaceProjectionInput {
  return {
    request: { status: 'RECIBIDA', currentAssigneeId: null, updatedAt: NOW },
    workingVersion: null,
    publishedVersion: null,
    document: null,
    delivery: null,
    conversation: { lastMessageFromCustomer: false },
    project: null,
    actor: actorWith(ALL_PERMISSIONS),
    now: NOW,
    ...overrides,
  };
}

describe('quote workspace projection resolver (D2-01 bridge)', () => {
  describe('request-only stages (no working or published version yet)', () => {
    it('projects an unassigned new request as claimable by staff', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ request: { status: 'RECIBIDA', currentAssigneeId: null, updatedAt: NOW } }));
      expect(projection).toMatchObject({ stage: 'NUEVA_SOLICITUD', actorExpected: 'STAFF', primaryAction: 'REQUEST_CLAIM', blockers: [] });
    });

    it('hides the claim action once the request already has a responsible', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ request: { status: 'RECIBIDA', currentAssigneeId: 'someone-else', updatedAt: NOW } }));
      expect(projection).toMatchObject({ stage: 'NUEVA_SOLICITUD', primaryAction: null });
    });

    it('projects EN_REVISION with a secondary ask-for-information action', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ request: { status: 'EN_REVISION', currentAssigneeId: 'staff-1', updatedAt: NOW } }));
      expect(projection).toMatchObject({ stage: 'EN_REVISION', actorExpected: 'STAFF', primaryAction: 'REQUEST_COMPLETE_REVIEW', secondaryActions: ['REQUEST_ASK_INFORMATION'] });
    });

    it('projects INFORMACION_REQUERIDA as waiting on the customer until they answer', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        request: { status: 'INFORMACION_REQUERIDA', currentAssigneeId: 'staff-1', updatedAt: NOW },
        conversation: { lastMessageFromCustomer: false },
      }));
      expect(projection).toMatchObject({ stage: 'ESPERANDO_CLIENTE', actorExpected: 'CUSTOMER', primaryAction: null, secondaryActions: ['REQUEST_REMIND_CUSTOMER'] });
    });

    it('projects INFORMACION_REQUERIDA as a staff response once the customer replies', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        request: { status: 'INFORMACION_REQUERIDA', currentAssigneeId: 'staff-1', updatedAt: NOW },
        conversation: { lastMessageFromCustomer: true },
      }));
      expect(projection).toMatchObject({ stage: 'RESPUESTA_RECIBIDA', actorExpected: 'STAFF', primaryAction: 'REQUEST_REVIEW_RESPONSE' });
    });

    it.each(['EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'] as const)('projects %s without a quote yet as ready to start a proposal', (status) => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ request: { status, currentAssigneeId: 'staff-1', updatedAt: NOW } }));
      expect(projection).toMatchObject({ stage: 'PREPARAR_PROPUESTA', actorExpected: 'STAFF', primaryAction: 'QUOTE_ADD_FIRST_LINE' });
    });

    it('projects a request rejected before any quote existed as a dead end', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ request: { status: 'RECHAZADA', currentAssigneeId: 'staff-1', updatedAt: NOW } }));
      expect(projection).toMatchObject({ stage: 'SOLICITUD_RECHAZADA', actorExpected: 'NONE', primaryAction: null });
    });

    it.each(['PENDIENTE_DE_APROBACION', 'ACEPTADA', 'VENCIDA'] as const)('throws for the impossible combination of %s with no quote at all', (status) => {
      expect(() => resolveQuoteWorkspaceProjection(baseInput({ request: { status, currentAssigneeId: 'staff-1', updatedAt: NOW } }))).toThrow(/Unclassified/);
    });
  });

  it('projects a converted request as a terminal handoff stage regardless of quote state', () => {
    const projection = resolveQuoteWorkspaceProjection(baseInput({ request: { status: 'CONVERTIDA_EN_PROYECTO', currentAssigneeId: 'staff-1', updatedAt: NOW } }));
    expect(projection).toMatchObject({ stage: 'SOLICITUD_CONVERTIDA', actorExpected: 'STAFF', primaryAction: null });
  });

  describe('working version sub-stages (draft in progress, not yet published)', () => {
    it('projects a saved draft as ready to submit for review', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ workingVersion: version({ status: 'BORRADOR' }) }));
      expect(projection).toMatchObject({ stage: 'BORRADOR_GUARDADO', actorExpected: 'STAFF', primaryAction: 'QUOTE_SUBMIT_FOR_REVIEW' });
    });

    it('projects a pending approval as waiting on a manager other than the requester', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        workingVersion: version({ status: 'EN_REVISION', approvals: [{ status: 'REQUESTED', requestedById: 'requester-1', requestedAt: PAST }] }),
        actor: actorWith(ALL_PERMISSIONS, 'manager-1'),
      }));
      expect(projection).toMatchObject({ stage: 'ESPERANDO_APROBACION', actorExpected: 'MANAGER', primaryAction: 'QUOTE_RESOLVE_APPROVAL', blockers: [] });
      expect(projection.waitingSince).toEqual(PAST);
    });

    it('blocks the requester from resolving their own pending approval (separation of duties)', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        workingVersion: version({ status: 'EN_REVISION', approvals: [{ status: 'REQUESTED', requestedById: 'same-user', requestedAt: PAST }] }),
        actor: actorWith(ALL_PERMISSIONS, 'same-user'),
      }));
      expect(projection).toMatchObject({ stage: 'ESPERANDO_APROBACION', primaryAction: null, blockers: ['SEPARATION_OF_DUTIES'] });
    });

    it('ignores resolved approvals and falls through to the document state', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        workingVersion: version({ status: 'EN_REVISION', approvals: [{ status: 'APPROVED', requestedById: 'requester-1', requestedAt: PAST }] }),
        document: { state: 'READY' },
      }));
      expect(projection).toMatchObject({ stage: 'LISTA_PARA_PUBLICAR', primaryAction: 'QUOTE_PUBLISH' });
    });

    it('projects a never-generated document as ready for staff to trigger generation', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ workingVersion: version({ status: 'EN_REVISION' }), document: null }));
      expect(projection).toMatchObject({ stage: 'PREPARAR_DOCUMENTO', actorExpected: 'STAFF', primaryAction: 'QUOTE_RETRY_DOCUMENT' });
    });

    it('projects an in-progress document generation as a system wait with no retry action', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ workingVersion: version({ status: 'EN_REVISION' }), document: { state: 'PENDING' } }));
      expect(projection).toMatchObject({ stage: 'PREPARANDO_DOCUMENTO', actorExpected: 'SYSTEM', primaryAction: null, blockers: ['DOCUMENT_NOT_READY'] });
    });

    it('projects a failed document as needing staff attention with a retry action', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ workingVersion: version({ status: 'EN_REVISION' }), document: { state: 'FAILED' } }));
      expect(projection).toMatchObject({ stage: 'DOCUMENTO_REQUIERE_ATENCION', actorExpected: 'STAFF', primaryAction: 'QUOTE_RETRY_DOCUMENT' });
    });

    it('projects a ready document as ready to publish', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ workingVersion: version({ status: 'EN_REVISION' }), document: { state: 'READY' } }));
      expect(projection).toMatchObject({ stage: 'LISTA_PARA_PUBLICAR', actorExpected: 'STAFF', primaryAction: 'QUOTE_PUBLISH' });
    });
  });

  describe('published version stages (no new working version in progress)', () => {
    it('projects an accepted publication as blocked on the missing project entity', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ publishedVersion: version({ status: 'ACEPTADA', updatedAt: NOW }) }));
      expect(projection).toMatchObject({ stage: 'ACEPTADA', actorExpected: 'STAFF', primaryAction: null, blockers: ['PROJECT_CONTRACT_MISSING'] });
    });

    it('projects a customer-rejected publication as a dead end', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ publishedVersion: version({ status: 'RECHAZADA' }) }));
      expect(projection).toMatchObject({ stage: 'PROPUESTA_RECHAZADA', primaryAction: null });
    });

    it('projects an explicitly expired version as cloneable', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ publishedVersion: version({ status: 'VENCIDA' }) }));
      expect(projection).toMatchObject({ stage: 'PROPUESTA_VENCIDA', primaryAction: 'QUOTE_CLONE_EXPIRED' });
    });

    it('projects a date-expired but not yet transitioned version as cloneable too (expiry never blocks a new working version)', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ publishedVersion: version({ status: 'ENVIADA', validUntil: PAST }) }));
      expect(projection).toMatchObject({ stage: 'PROPUESTA_VENCIDA', primaryAction: 'QUOTE_CLONE_EXPIRED' });
    });

    it('projects a live publication with a customer change request as ready for a new revision', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        publishedVersion: version({ status: 'ENVIADA', validUntil: FUTURE }),
        conversation: { lastMessageFromCustomer: true },
      }));
      expect(projection).toMatchObject({ stage: 'CAMBIOS_SOLICITADOS', primaryAction: 'QUOTE_CREATE_REVISION' });
    });

    it('projects a retryable failed delivery as actionable by staff', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        publishedVersion: version({ status: 'ENVIADA', validUntil: FUTURE }),
        delivery: { state: 'FAILED', retryable: true, updatedAt: NOW },
      }));
      expect(projection).toMatchObject({ stage: 'AVISO_FALLIDO', actorExpected: 'STAFF', primaryAction: 'QUOTE_RETRY_DELIVERY' });
    });

    it('projects a non-recoverable failed delivery with no action to offer', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        publishedVersion: version({ status: 'ENVIADA', validUntil: FUTURE }),
        delivery: { state: 'FAILED', retryable: false, updatedAt: NOW },
      }));
      expect(projection).toMatchObject({ stage: 'AVISO_FALLIDO', primaryAction: null });
    });

    it('projects a sent delivery as waiting on the customer decision', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        publishedVersion: version({ status: 'ENVIADA', validUntil: FUTURE }),
        delivery: { state: 'SENT', retryable: false, updatedAt: NOW },
      }));
      expect(projection).toMatchObject({ stage: 'ESPERANDO_DECISION', actorExpected: 'CUSTOMER', primaryAction: null });
    });

    it.each(['NONE', 'PENDING', 'PROCESSING', 'CANCELLED'] as const)('projects delivery state %s as a plain published-and-waiting stage', (deliveryState) => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        publishedVersion: version({ status: 'ENVIADA', validUntil: FUTURE }),
        delivery: deliveryState === 'NONE' ? null : { state: deliveryState, retryable: false, updatedAt: NOW },
      }));
      expect(projection).toMatchObject({ stage: 'PROPUESTA_PUBLICADA', actorExpected: 'SYSTEM', primaryAction: null });
    });

    it('treats EN_NEGOCIACION the same as ENVIADA for a live, undelivered publication', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ publishedVersion: version({ status: 'EN_NEGOCIACION', validUntil: FUTURE }) }));
      expect(projection).toMatchObject({ stage: 'PROPUESTA_PUBLICADA' });
    });

    it('throws for a published pointer stuck in an editable status (data inconsistency)', () => {
      expect(() => resolveQuoteWorkspaceProjection(baseInput({ publishedVersion: version({ status: 'EN_REVISION' }) }))).toThrow(/Unclassified/);
    });
  });

  describe('revising after publication (a working version alongside a still-published one)', () => {
    it('keeps the published version visible while relabeling the top-level stage', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        workingVersion: version({ id: 'v2', versionNumber: 2, status: 'BORRADOR' }),
        publishedVersion: version({ id: 'v1', versionNumber: 1, status: 'ENVIADA', validUntil: FUTURE }),
      }));
      expect(projection.stage).toBe('REVISANDO_CAMBIOS');
      expect(projection.primaryAction).toBe('QUOTE_SUBMIT_FOR_REVIEW');
      expect(projection.publishedVersion).toMatchObject({ id: 'v1', versionNumber: 1 });
      expect(projection.workingVersion).toMatchObject({ id: 'v2', versionNumber: 2 });
    });

    it('lets a new working version proceed even when the previous publication ended terminally', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        workingVersion: version({ id: 'v2', versionNumber: 2, status: 'EN_REVISION' }),
        publishedVersion: version({ id: 'v1', versionNumber: 1, status: 'RECHAZADA' }),
        document: { state: 'READY' },
      }));
      expect(projection).toMatchObject({ stage: 'REVISANDO_CAMBIOS', primaryAction: 'QUOTE_PUBLISH' });
      expect(projection.publishedVersion).toMatchObject({ id: 'v1', status: 'RECHAZADA' });
    });
  });

  describe('permission gating (the server, not the client, decides what is actionable)', () => {
    it('hides the claim action when the actor lacks requests.assign', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({ actor: actorWith([]) }));
      expect(projection).toMatchObject({ stage: 'NUEVA_SOLICITUD', primaryAction: null });
    });

    it('hides the approval-resolution action when the actor lacks quotes.approve_discount', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        workingVersion: version({ status: 'EN_REVISION', approvals: [{ status: 'REQUESTED', requestedById: 'requester-1', requestedAt: PAST }] }),
        actor: actorWith([], 'manager-1'),
      }));
      expect(projection).toMatchObject({ stage: 'ESPERANDO_APROBACION', primaryAction: null });
    });

    it('filters ungranted secondary actions out instead of leaving a dead action visible', () => {
      const projection = resolveQuoteWorkspaceProjection(baseInput({
        request: { status: 'EN_REVISION', currentAssigneeId: 'staff-1', updatedAt: NOW },
        actor: actorWith(['requests.status.update']),
      }));
      expect(projection.secondaryActions).toEqual([]);
    });
  });

  it('documents that this bridge vocabulary is not the ADR-approved target contract (see docs/adr/2026-09-10-commercial-lifecycle-v2.md)', () => {
    // Intentional: this bridge module does NOT implement TRUTH_CASES from
    // tests/fixtures/commercial-workflow-v2.ts; it derives an equivalent projection from
    // today's real schema instead. It is replaced wholesale, never extended, once D1 delivers
    // QuotePublication/revision/contentDigest and this vocabulary can be implemented faithfully.
    expect(new Set(WORKSPACE_STAGES)).not.toEqual(new Set(TARGET_STATES.QUOTE_REQUEST));
    expect(new Set(WORKSPACE_ACTIONS)).not.toEqual(new Set(ACTION_CATALOG));
  });
});
