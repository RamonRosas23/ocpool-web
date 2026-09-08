import { describe, expect, it } from 'vitest';
import {
  evaluateProductionReadiness,
  type ReadinessCheck,
} from '../../scripts/production-readiness.mjs';

const pass = (id: string): ReadinessCheck => ({
  id,
  status: 'PASS',
  summary: 'Control aprobado.',
});

describe('production readiness gate', () => {
  it('returns PASS when technical and external checks are complete', () => {
    const report = evaluateProductionReadiness({
      technicalChecks: [pass('TECH_SCHEMA')],
      externalChecks: [pass('EXT_PROVIDER')],
    });

    expect(report.status).toBe('PASS');
    expect(report.counts).toEqual({ PASS: 2, WARN: 0, BLOCKED: 0 });
    expect(report.checks.map((check) => check.id)).toEqual(['EXT_PROVIDER', 'TECH_SCHEMA']);
  });

  it('preserves WARN but escalates the report to BLOCKED for any blocker', () => {
    const report = evaluateProductionReadiness({
      technicalChecks: [
        { id: 'TECH_OPTIONAL', status: 'WARN', summary: 'Evidencia pendiente.' },
        { id: 'TECH_BLOCKED', status: 'BLOCKED', summary: 'Configuración incompleta.' },
      ],
    });

    expect(report.status).toBe('BLOCKED');
    expect(report.counts).toEqual({ PASS: 0, WARN: 1, BLOCKED: 1 });
  });

  it('deduplicates and sorts IDs while keeping output safe', () => {
    const secret = 'postgresql://ocpool:secret@localhost:55432/ocpool_dev';
    const report = evaluateProductionReadiness({
      technicalChecks: [
        { id: 'Z_CHECK', status: 'PASS', summary: 'OK' },
        { id: 'A_CHECK', status: 'WARN', summary: 'Revisión pendiente.' },
        { id: 'Z_CHECK', status: 'PASS', summary: 'OK' },
      ],
      externalChecks: [{ id: 'EXT_CHECK', status: 'BLOCKED', summary: 'Proveedor pendiente.' }],
    });

    const serialized = JSON.stringify(report);
    expect(report.checks.map((check) => check.id)).toEqual(['A_CHECK', 'EXT_CHECK', 'Z_CHECK']);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/password|token|secret|DATABASE_URL|[A-Z]:\\\\/i);
  });
});
