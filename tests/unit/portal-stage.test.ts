import { describe, expect, it } from 'vitest';
import { portalNextStep, portalStages, portalStatusLabel } from '@/lib/portal-stage';

const states = (status: string) => portalStages(status).map((stage) => stage.state);
const base = { hasQuote: false, quoteExpired: false, quoteAccepted: false, quoteActionable: false };

describe('portalStages', () => {
  it('maps internal statuses to the five stages a customer recognizes', () => {
    expect(states('RECIBIDA')).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(states('INFORMACION_REQUERIDA')).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming']);
    expect(states('COTIZACION_DISPONIBLE')).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
    expect(states('ACEPTADA')).toEqual(['done', 'done', 'done', 'current', 'upcoming']);
    expect(states('CONVERTIDA_EN_PROYECTO')).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('marks a rejected or expired proposal as a closed stage', () => {
    expect(states('VENCIDA')[2]).toBe('closed');
    expect(states('RECHAZADA')[2]).toBe('closed');
  });
});

describe('portalStatusLabel', () => {
  it('speaks the customer language instead of internal status names', () => {
    expect(portalStatusLabel('COTIZACION_DISPONIBLE')).toBe('Propuesta lista');
    expect(portalStatusLabel('CONVERTIDA_EN_PROYECTO')).toBe('Proyecto en marcha');
    expect(portalStatusLabel('INFORMACION_REQUERIDA')).toBe('Datos pendientes');
    expect(portalStatusLabel('RECHAZADA')).toBe('Cerrada');
  });
});

describe('portalNextStep', () => {
  it('points the customer at the action that is on their side', () => {
    expect(portalNextStep({ ...base, status: 'INFORMACION_REQUERIDA' })).toMatchObject({ target: 'conversation', owner: 'customer' });
    expect(portalNextStep({ ...base, status: 'COTIZACION_DISPONIBLE', hasQuote: true, quoteActionable: true })).toMatchObject({ title: 'Tu propuesta está lista', target: 'quote' });
    expect(portalNextStep({ ...base, status: 'VENCIDA', hasQuote: true, quoteExpired: true })).toMatchObject({ title: 'Tu propuesta venció', target: 'quote' });
  });

  it('says a closed file is closed, even when its retired proposal also expired', () => {
    expect(portalNextStep({ ...base, status: 'RECHAZADA', hasQuote: true, quoteExpired: true })).toMatchObject({ title: 'Este expediente se cerró', target: 'conversation', owner: 'customer' });
    expect(portalNextStep({ ...base, status: 'RECHAZADA' })).toMatchObject({ title: 'Este expediente se cerró' });
    // VENCIDA (estado heredado) significa "la propuesta venció", aunque su fecha no haya pasado.
    expect(portalNextStep({ ...base, status: 'VENCIDA', hasQuote: true })).toMatchObject({ title: 'Tu propuesta venció', target: 'quote' });
  });

  it('tells the customer when the ball is on the team side', () => {
    expect(portalNextStep({ ...base, status: 'EN_REVISION' })).toMatchObject({ owner: 'team', target: null });
    // Después de "Solicitar cambios" ya no se le dice que su propuesta "está lista".
    expect(portalNextStep({ ...base, status: 'COTIZACION_DISPONIBLE', hasQuote: true, quoteActionable: true, changesRequested: true })).toMatchObject({ title: 'Pediste cambios a tu propuesta', owner: 'team', target: 'conversation' });
    expect(portalNextStep({ ...base, status: 'ACEPTADA', hasQuote: true, quoteAccepted: true })).toMatchObject({ title: 'Aceptaste la propuesta', owner: 'team' });
    expect(portalNextStep({ ...base, status: 'CONVERTIDA_EN_PROYECTO' }).owner).toBe('done');
  });

  it('guides the customer to the conversation after declining a proposal', () => {
    expect(portalNextStep({ ...base, status: 'EN_NEGOCIACION', hasQuote: true, proposalDeclined: true }))
      .toMatchObject({ title: 'Declinaste esta propuesta', target: 'conversation', cta: 'Pedir una nueva versión', owner: 'team' });
  });
});
