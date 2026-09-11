import { describe, expect, it } from 'vitest';
import {
  BASELINE_DATA_RULES,
  BASELINE_EVENT_RULES,
  BASELINE_MEASUREMENT_REQUIRED_FIELDS,
  BASELINE_METRICS,
  BASELINE_SCENARIOS,
  BASELINE_SURFACES,
  BASELINE_VIEWPORTS,
  CURRENT_BASELINE_OBSERVATIONS,
  REPRESENTATIVE_VOLUME_PROFILES,
  validateBaselineMeasurementRecord,
} from '../fixtures/commercial-baseline-v2';

describe('commercial baseline V2 fixture', () => {
  it('covers public/private surfaces and responsive viewports without claiming authenticated evidence', () => {
    expect(BASELINE_VIEWPORTS.map((viewport) => viewport.id)).toEqual(['mobile', 'tablet', 'desktop']);
    expect(BASELINE_SURFACES).toHaveLength(8);
    expect(CURRENT_BASELINE_OBSERVATIONS).toHaveLength(BASELINE_SURFACES.length);
    expect(CURRENT_BASELINE_OBSERVATIONS.every((observation) => ['unauthenticated-browser-inspection', 'anonymous-browser-inspection'].includes(observation.evidence))).toBe(true);
  });

  it('keeps the scenario matrix tied to measurable outcomes', () => {
    expect(BASELINE_SCENARIOS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(BASELINE_SCENARIOS.map((scenario) => scenario.id)).size).toBe(BASELINE_SCENARIOS.length);
    for (const scenario of BASELINE_SCENARIOS) {
      expect(scenario.start).toMatch(/^\//u);
      expect(scenario.end).not.toHaveLength(0);
      expect(scenario.targetMetric).not.toHaveLength(0);
      expect(scenario.fixture).not.toHaveLength(0);
    }
    expect(BASELINE_SCENARIOS.every((scenario) => BASELINE_METRICS.some((metric) => metric.id === scenario.targetMetric))).toBe(true);
  });

  it('defines privacy-safe metric events and all required baseline metrics', () => {
    expect(BASELINE_METRICS.map((metric) => metric.id)).toEqual([
      'public_request_to_confirmation',
      'request_to_next_task',
      'request_to_draft',
      'add_ten_concepts',
      'publish_quote',
      'draft_to_approval_resolution',
      'document_failure_to_recovery',
      'delivery_failure_to_recovery',
      'published_to_new_working',
      'expired_quote_to_next_step',
      'portal_access_to_decision',
      'workflow_errors',
      'workflow_abandonment',
    ]);
    expect(BASELINE_EVENT_RULES.eventNamePattern.test('quote.draft_saved')).toBe(true);
    expect(BASELINE_EVENT_RULES.eventNamePattern.test('Quote Draft Saved')).toBe(false);
    expect(BASELINE_EVENT_RULES.forbiddenFields).toEqual(expect.arrayContaining(['email', 'token', 'messageBody', 'ipAddress']));
    expect(new Set(BASELINE_METRICS.map((metric) => metric.id)).size).toBe(BASELINE_METRICS.length);
    for (const metric of BASELINE_METRICS) {
      expect(metric.startEvent).toMatch(BASELINE_EVENT_RULES.eventNamePattern);
      expect(metric.endEvent).toMatch(BASELINE_EVENT_RULES.eventNamePattern);
    }
    expect(BASELINE_METRICS.every((metric) => metric.target === 'PENDING_PRODUCT_TARGET')).toBe(true);
  });

  it('includes the planned representative volume profiles and handling rules', () => {
    expect(REPRESENTATIVE_VOLUME_PROFILES).toEqual(expect.arrayContaining([
      expect.objectContaining({ aggregate: 'quote_requests', count: 10_000 }),
      expect.objectContaining({ aggregate: 'catalog_items', count: 5_000 }),
      expect.objectContaining({ aggregate: 'quote_versions_per_request', count: 100 }),
      expect.objectContaining({ aggregate: 'quote_lines_per_document', count: 100 }),
    ]));
    expect(BASELINE_DATA_RULES.length).toBeGreaterThanOrEqual(5);
    expect(BASELINE_DATA_RULES.some((rule) => rule.includes('production email'))).toBe(true);
  });

  it('accepts only complete synthetic measurement records', () => {
    const record = {
      schemaVersion: 1 as const,
      metricId: 'request_to_draft' as const,
      scenarioId: 'draft-quote' as const,
      actorType: 'SALES' as const,
      surface: 'staff-quotes' as const,
      viewport: 'desktop' as const,
      seedVersion: 'baseline-fixture-v1',
      commit: 'abc1234',
      startedAt: '2026-09-10T12:00:00.000Z',
      endedAt: '2026-09-10T12:00:04.250Z',
      durationMs: 4250,
      errorCount: 0,
      abandoned: false,
    };
    expect(BASELINE_MEASUREMENT_REQUIRED_FIELDS).toHaveLength(13);
    expect(validateBaselineMeasurementRecord(record)).toEqual([]);
  });

  it('rejects PII, invalid dimensions and incomplete timing records', () => {
    const errors = validateBaselineMeasurementRecord({
      schemaVersion: 2,
      metricId: 'unknown',
      scenarioId: 'unknown',
      actorType: 'SALES',
      surface: 'staff-quotes',
      viewport: 'desktop',
      seedVersion: 'seed',
      commit: 'commit',
      startedAt: 'not-a-date',
      endedAt: '2026-09-10T12:00:00.000Z',
      durationMs: -1,
      errorCount: 1.5,
      abandoned: 'no',
      email: 'never@example.test',
      context: { token: 'forbidden' },
    });
    expect(errors).toEqual(expect.arrayContaining([
      'forbidden field: email',
      'forbidden field: context.token',
      'schemaVersion must be 1',
      'metricId is not in the baseline dictionary',
      'scenarioId is not in the baseline matrix',
      'startedAt must be an ISO date',
      'durationMs must be a non-negative finite number',
      'errorCount must be a non-negative integer',
      'abandoned must be boolean',
    ]));
  });
});
