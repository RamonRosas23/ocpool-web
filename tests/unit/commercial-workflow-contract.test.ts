import { describe, expect, it } from 'vitest';
import {
  ACTION_CATALOG,
  ALL_CURRENT_STATUS_VALUES,
  BLOCKER_CATALOG,
  CURRENT_STATE_INVENTORY,
  INVARIANT_CATALOG,
  LEGACY_STATUS_MAPPINGS,
  TARGET_INITIAL_STATES,
  TARGET_OWNERSHIP,
  TARGET_STATES,
  TARGET_TRANSITIONS,
  TRUTH_CASES,
  WORKFLOW_ENTITIES,
} from '../fixtures/commercial-workflow-v2';

const asSet = (values: readonly string[]) => new Set(values);

describe('commercial workflow V2 contract fixture', () => {
  it('covers every source of commercial truth before a resolver exists', () => {
    expect(CURRENT_STATE_INVENTORY.map((entry) => entry.entity)).toEqual([...WORKFLOW_ENTITIES]);
    expect(TARGET_OWNERSHIP.map((entry) => entry.entity)).toEqual([...WORKFLOW_ENTITIES]);
    expect(CURRENT_STATE_INVENTORY.every((entry) => entry.owner && entry.targetOwner && entry.reachableBy.every(Boolean))).toBe(true);
    expect(ALL_CURRENT_STATUS_VALUES.length).toBeGreaterThanOrEqual(WORKFLOW_ENTITIES.length);
  });

  it('defines unique target states, initial states and transition references', () => {
    for (const entity of WORKFLOW_ENTITIES) {
      const states = TARGET_STATES[entity];
      expect(new Set(states).size, `${entity} has duplicate states`).toBe(states.length);
      expect(states).toContain(TARGET_INITIAL_STATES[entity]);
      const entityTransitions = TARGET_TRANSITIONS.filter((transition) => transition.entity === entity);
      for (const transition of entityTransitions) {
        expect(states, `${transition.id} has invalid from state`).toContain(transition.from);
        expect(states, `${transition.id} has invalid to state`).toContain(transition.to);
        expect(transition.event).not.toHaveLength(0);
        expect(transition.auditAction).not.toHaveLength(0);
        expect(transition.visibleStage).not.toHaveLength(0);
        expect(transition.preconditions.length).toBeGreaterThan(0);
      }
      const incomingStates = asSet(entityTransitions.map((transition) => transition.to));
      for (const state of states) {
        if (state !== TARGET_INITIAL_STATES[entity]) expect(incomingStates, `${entity}.${state} is unreachable`).toContain(state);
      }
    }
    expect(new Set(TARGET_TRANSITIONS.map((transition) => transition.id)).size).toBe(TARGET_TRANSITIONS.length);
  });

  it('requires every transition to leave auditable and delivery-aware evidence', () => {
    for (const transition of TARGET_TRANSITIONS) {
      expect(transition.auditAction).toMatch(/^[a-z][a-z0-9_.]+$/u);
      if (transition.actor !== 'SYSTEM' || transition.outboxEvent !== null) expect(transition.outboxEvent === null || transition.outboxEvent.length > 0).toBe(true);
    }
    expect(TARGET_TRANSITIONS.some((transition) => transition.id === 'publication.publish' && transition.outboxEvent === 'QUOTE.PUBLISHED')).toBe(true);
    expect(TARGET_TRANSITIONS.some((transition) => transition.id === 'delivery.fail' && transition.to === 'FAILED')).toBe(true);
    expect(TARGET_TRANSITIONS.some((transition) => transition.id === 'delivery.cancel' && transition.to === 'CANCELLED')).toBe(true);
  });

  it('keeps legacy meanings explicit and prevents the old approval conflation', () => {
    expect(LEGACY_STATUS_MAPPINGS.map((mapping) => mapping.legacyStatus)).toContain('PENDIENTE_DE_APROBACION');
    const pendingApproval = LEGACY_STATUS_MAPPINGS.find((mapping) => mapping.legacyStatus === 'PENDIENTE_DE_APROBACION');
    expect(pendingApproval).toMatchObject({ targetOwner: 'QUOTE_APPROVAL', forbiddenMeaning: 'discount_approval' });
    expect(LEGACY_STATUS_MAPPINGS.some((mapping) => mapping.legacyStatus === 'VENCIDA' && mapping.forbiddenMeaning === 'block_new_working_version')).toBe(true);
    for (const mapping of LEGACY_STATUS_MAPPINGS) {
      expect(mapping.entity).not.toHaveLength(0);
      expect(mapping.targetMeaning).not.toHaveLength(0);
      expect(mapping.forbiddenMeaning).not.toHaveLength(0);
    }
  });

  it('has a closed action/blocker vocabulary and complete valid/invalid truth cases', () => {
    expect(new Set(ACTION_CATALOG).size).toBe(ACTION_CATALOG.length);
    expect(new Set(BLOCKER_CATALOG).size).toBe(BLOCKER_CATALOG.length);
    expect(new Set(TRUTH_CASES.map((truthCase) => truthCase.id)).size).toBe(TRUTH_CASES.length);
    expect(TRUTH_CASES.filter((truthCase) => truthCase.kind === 'VALID').length).toBeGreaterThanOrEqual(10);
    expect(TRUTH_CASES.filter((truthCase) => truthCase.kind === 'INVALID').length).toBeGreaterThanOrEqual(5);
    for (const truthCase of TRUTH_CASES) {
      expect(truthCase.description).not.toHaveLength(0);
      expect(truthCase.expected.stage).not.toHaveLength(0);
      if (truthCase.expected.primaryAction) expect(ACTION_CATALOG).toContain(truthCase.expected.primaryAction);
      for (const blocker of truthCase.expected.blockers) expect(BLOCKER_CATALOG).toContain(blocker);
      if (truthCase.kind === 'INVALID') expect(truthCase.expected.blockers.length).toBeGreaterThan(0);
      if (truthCase.kind === 'VALID') expect(truthCase.expected.blockers).toHaveLength(0);
      expect(truthCase.expected.effects.length).toBeGreaterThan(0);
    }
  });

  it('proves the non-negotiable working/published and publication invariants', () => {
    const retainedPublication = TRUTH_CASES.find((truthCase) => truthCase.id === 'new-working-keeps-published');
    expect(retainedPublication?.expected.visiblePublishedVersion).toBe('V1');
    expect(retainedPublication?.facts.workingVersion).toBe('V2');
    expect(retainedPublication?.facts.publishedVersion).toBe('V1');

    const publishWithoutDocument = TRUTH_CASES.find((truthCase) => truthCase.id === 'publish-without-document');
    expect(publishWithoutDocument?.expected.blockers).toContain('DOCUMENT_NOT_READY');
    expect(publishWithoutDocument?.expected.canAccept).toBe(false);

    const foreignCustomer = TRUTH_CASES.find((truthCase) => truthCase.id === 'foreign-customer');
    expect(foreignCustomer?.expected.blockers).toContain('CLIENT_SCOPE');
    expect(foreignCustomer?.expected.visiblePublishedVersion).toBe('NONE');

    const staleAcceptance = TRUTH_CASES.find((truthCase) => truthCase.id === 'stale-acceptance');
    expect(staleAcceptance?.expected.blockers).toContain('PUBLISHED_VERSION_MISMATCH');
  });

  it('names every invariant that D1/D2 must preserve', () => {
    const invariantIds = INVARIANT_CATALOG.map((invariant) => invariant.id);
    expect(new Set(invariantIds).size).toBe(invariantIds.length);
    for (const invariant of INVARIANT_CATALOG) expect(invariant.statement).not.toHaveLength(0);
    expect(invariantIds).toEqual(expect.arrayContaining([
      'working_published_distinct',
      'published_only_portal',
      'snapshot_everywhere',
      'pdf_before_publication',
      'terms_server_owned',
      'idempotency_payload_bound',
      'customer_scope',
    ]));
  });
});
