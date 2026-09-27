import { describe, expect, it } from 'vitest';
import { quoteNextStep, quoteStageSteps, type QuoteStageInput } from '@/lib/quote-stage';

const base: QuoteStageInput = {
  versionStatus: 'BORRADOR',
  lineCount: 2,
  priceListSelected: true,
  approvalNeeded: false,
  approvalGranted: false,
  approvalRequested: false,
  canApprove: false,
  canSend: true,
  canEdit: true,
};

const states = (input: QuoteStageInput) => quoteStageSteps(input).map((step) => step.state);

describe('quoteStageSteps', () => {
  it('marks the current stage and everything before it as done', () => {
    expect(states({ ...base, versionStatus: null })).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(states({ ...base, versionStatus: 'EN_REVISION' })).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(states({ ...base, versionStatus: 'EN_NEGOCIACION' })).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(states({ ...base, versionStatus: 'ACEPTADA' })).toEqual(['done', 'done', 'done', 'done']);
  });

  it('shows rejected or expired versions as a closed sent step with its reason', () => {
    const steps = quoteStageSteps({ ...base, versionStatus: 'VENCIDA' });
    expect(steps[2]).toEqual({ key: 'sent', label: 'Enviada', state: 'closed', note: 'Vencida' });
  });

  it('annotates the review step only when an approval applies', () => {
    expect(quoteStageSteps(base)[1].note).toBeUndefined();
    expect(quoteStageSteps({ ...base, approvalNeeded: true })[1].note).toBe('Requiere aprobación');
    expect(quoteStageSteps({ ...base, approvalNeeded: true, approvalRequested: true })[1].note).toBe('En aprobación');
    expect(quoteStageSteps({ ...base, approvalNeeded: true, approvalGranted: true })[1].note).toBe('Aprobada');
  });
});

describe('quoteNextStep', () => {
  it('guides the draft from price list to lines to review', () => {
    expect(quoteNextStep({ ...base, priceListSelected: false }).title).toBe('Elige una lista de precios');
    expect(quoteNextStep({ ...base, lineCount: 0 }).title).toBe('Agrega los conceptos');
    expect(quoteNextStep(base).title).toBe('Pasa la versión a revisión');
    expect(quoteNextStep({ ...base, canEdit: false }).title).toBe('Sólo lectura');
  });

  it('blocks sending until a required approval is granted, from the right point of view', () => {
    const review = { ...base, versionStatus: 'EN_REVISION', approvalNeeded: true };
    expect(quoteNextStep(review)).toMatchObject({ title: 'Solicita la aprobación', tone: 'blocked' });
    expect(quoteNextStep({ ...review, approvalRequested: true })).toMatchObject({ title: 'Esperando aprobación', tone: 'waiting' });
    expect(quoteNextStep({ ...review, approvalRequested: true, canApprove: true })).toMatchObject({ title: 'Decide la aprobación', tone: 'action' });
    expect(quoteNextStep({ ...review, approvalGranted: true })).toMatchObject({ title: 'Envía la cotización', tone: 'action' });
    expect(quoteNextStep({ ...review, approvalGranted: true, canSend: false })).toMatchObject({ title: 'Lista para enviar', tone: 'waiting' });
  });

  it('shows the manager rejection reason until the approval is requested again', () => {
    const rejected = { ...base, versionStatus: 'EN_REVISION', approvalNeeded: true, approvalRejectedReason: 'Propón máximo 10%.' };
    expect(quoteNextStep(rejected)).toMatchObject({ title: 'Gerencia rechazó la aprobación', tone: 'blocked', target: 'actions' });
    expect(quoteNextStep(rejected).detail).toContain('«Propón máximo 10%». Ajusta');
    expect(quoteStageSteps(rejected)[1].note).toBe('Rechazada por gerencia');
    // Un rechazo sin motivo sigue explicando qué hacer; volver a pedirla regresa a "Esperando aprobación".
    expect(quoteNextStep({ ...rejected, approvalRejectedReason: '' }).detail).toContain('vuelve a solicitarla');
    expect(quoteNextStep({ ...rejected, approvalRequested: true })).toMatchObject({ title: 'Esperando aprobación' });
  });

  it('explains what happens after sending, accepting, rejecting or expiring', () => {
    expect(quoteNextStep({ ...base, versionStatus: 'ENVIADA' }).title).toBe('Esperando al cliente');
    // Si el cliente pidió cambios desde su portal, la pelota vuelve al equipo con su petición textual.
    const changes = quoteNextStep({ ...base, versionStatus: 'EN_NEGOCIACION', changesRequested: 'Azulejo color arena.' });
    expect(changes).toMatchObject({ title: 'El cliente pidió cambios', tone: 'action', target: 'actions' });
    expect(changes.detail).toContain('«Azulejo color arena». Crea una nueva versión');
    expect(quoteNextStep({ ...base, versionStatus: 'ACEPTADA' }).title).toBe('Convierte en proyecto');
    expect(quoteNextStep({ ...base, versionStatus: 'ACEPTADA', projectCreated: true }).tone).toBe('done');
    expect(quoteNextStep({ ...base, versionStatus: 'RECHAZADA' }).title).toBe('Versión rechazada');
    expect(quoteNextStep({ ...base, versionStatus: 'VENCIDA' }).title).toBe('Versión vencida');
  });

  it('points each actionable step at the control that resolves it', () => {
    expect(quoteNextStep({ ...base, priceListSelected: false }).target).toBe('price-list');
    expect(quoteNextStep({ ...base, lineCount: 0 }).target).toBe('lines');
    expect(quoteNextStep(base).target).toBe('actions');
    expect(quoteNextStep({ ...base, versionStatus: 'ACEPTADA' }).target).toBe('document');
    expect(quoteNextStep({ ...base, versionStatus: 'ENVIADA' }).target).toBeUndefined();
    expect(quoteNextStep({ ...base, versionStatus: 'EN_REVISION', approvalNeeded: true, approvalRequested: true }).target).toBeUndefined();
  });
});
