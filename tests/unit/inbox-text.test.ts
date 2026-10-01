import { describe, expect, it } from 'vitest';
import { INBOX_CUSTOMER_SAFE_KEYS, INBOX_KINDS, isInboxKind, sanitizeInboxData, type InboxKind } from '@/server/modules/inbox/kinds';
import { inboxOccurrences, mergeInboxData, renderInboxText, staffActivityTitle, teamActivityTitle } from '@/server/modules/inbox/text';
import { filePreview, messagePreview, totalLabel } from '@/server/modules/inbox/format';

describe('inbox catalog', () => {
  it('only lets customer-facing kinds carry customer-safe data', () => {
    for (const [kind, definition] of Object.entries(INBOX_KINDS)) {
      if (definition.audience !== 'CUSTOMER') continue;
      for (const key of definition.dataKeys) expect(INBOX_CUSTOMER_SAFE_KEYS, `${kind}.${key}`).toContain(key);
    }
  });

  it('recognizes only catalog kinds', () => {
    expect(isInboxKind('customer.activity')).toBe(true);
    expect(isInboxKind('toString')).toBe(false);
    expect(isInboxKind('customer.unknown')).toBe(false);
  });

  it('drops fields a kind does not allow, trims text and rejects negative counts', () => {
    const cleaned = sanitizeInboxData('team.activity', { folio: '  OCQ-2026-000001 ', messages: -1, files: 2, reason: 'Nota interna que nunca debe llegar', preview: 'a'.repeat(400) });
    expect(cleaned).toEqual({ folio: 'OCQ-2026-000001', files: 2, preview: `${'a'.repeat(179)}…` });
  });
});

describe('inbox text', () => {
  it('describes grouped customer activity in plain language', () => {
    expect(staffActivityTitle('Laura Méndez', 1, 0)).toBe('Laura Méndez te escribió');
    expect(staffActivityTitle('Laura Méndez', 3, 0)).toBe('Laura Méndez te escribió 3 mensajes');
    expect(staffActivityTitle('Laura Méndez', 0, 1)).toBe('Laura Méndez subió un archivo');
    expect(staffActivityTitle('Laura Méndez', 1, 2)).toBe('Laura Méndez subió 2 archivos y dejó un mensaje');
    expect(staffActivityTitle('Laura Méndez', 2, 1)).toBe('Laura Méndez subió un archivo y dejó 2 mensajes');
    expect(teamActivityTitle(1, 0)).toBe('El equipo OCPOOL te escribió');
    expect(teamActivityTitle(2, 1)).toBe('El equipo OCPOOL te escribió 2 mensajes y compartió un archivo');
    expect(teamActivityTitle(0, 3)).toBe('El equipo OCPOOL compartió 3 archivos');
  });

  it('renders every kind with a bounded title', () => {
    for (const kind of Object.keys(INBOX_KINDS) as InboxKind[]) {
      const text = renderInboxText(kind, { folio: 'OCQ-2026-000123', clientName: 'Juan Pérez', actorName: 'Ana Ruiz', versionNumber: 2, messages: 1, itemName: 'Bomba', priceListName: 'Lista MXN', projectFolio: 'OCP-2026-0001' });
      expect(text.title.length, kind).toBeGreaterThan(5);
      expect(text.title.length, kind).toBeLessThanOrEqual(200);
      expect(text.body === null || text.body.length <= 400, kind).toBe(true);
    }
    expect(renderInboxText('quote.accepted', { actorName: 'Juan Pérez', versionNumber: 2, totalLabel: 'Total aceptado: MXN 485,000.00' })).toEqual({ title: 'Juan Pérez aceptó la propuesta V2', body: 'Total aceptado: MXN 485,000.00' });
    expect(renderInboxText('quote.declined', { actorName: 'Juan Pérez', versionNumber: 2, reason: 'El precio' })).toEqual({ title: 'Juan Pérez declinó la propuesta V2', body: 'Motivo: El precio.' });
    expect(renderInboxText('quote.viewed', { actorName: 'Juan Pérez', versionNumber: 2, folio: 'OCQ-2' })).toEqual({ title: 'Juan Pérez abrió la propuesta V2', body: 'OCQ-2' });
    expect(renderInboxText('customer.portal_activated', { actorName: 'Juan Pérez', folio: 'OCQ-2' })).toEqual({ title: 'Juan Pérez activó su portal', body: 'OCQ-2' });
    expect(renderInboxText('request.new_unassigned', { projectType: 'Alberca con jacuzzi', location: 'Monterrey', clientName: 'Sofía Garza', folio: 'OCQ-2026-000130' })).toEqual({ title: 'Nueva solicitud: Alberca con jacuzzi en Monterrey', body: 'Sofía Garza · OCQ-2026-000130' });
    expect(renderInboxText('approval.resolved', { actorName: 'Pedro', approvalType: 'DISCOUNT', approvalStatus: 'REJECTED', folio: 'OCQ-1', reason: 'Excede el margen' }).title).toBe('Pedro rechazó tu descuento en OCQ-1');
  });

  it('adds up grouped activity and keeps the latest preview', () => {
    const merged = mergeInboxData('customer.activity', { messages: 1, files: 0, preview: '“Hola”' }, { messages: 0, files: 1, preview: 'Archivo: plano.pdf' });
    expect(merged).toEqual({ changed: true, data: { messages: 1, files: 1, preview: 'Archivo: plano.pdf' } });
    expect(inboxOccurrences('customer.activity', merged.data, 1)).toBe(2);
  });

  it('unions pending-price requests idempotently', () => {
    const first = mergeInboxData('price.pending', { requestIds: ['a'], requestFolios: ['OCQ-A'] }, { requestIds: ['b'], requestFolios: ['OCQ-B'] });
    expect(first).toEqual({ changed: true, data: { requestIds: ['a', 'b'], requestFolios: ['OCQ-A', 'OCQ-B'] } });
    expect(mergeInboxData('price.pending', first.data, { requestIds: ['a'], requestFolios: ['OCQ-A'] }).changed).toBe(false);
    expect(inboxOccurrences('price.pending', first.data, 1)).toBe(2);
    expect(renderInboxText('price.pending', { itemName: 'Bomba', priceListName: 'Lista MXN', requestFolios: ['OCQ-A', 'OCQ-B'] }).body).toBe('Lo esperan 2 propuestas: OCQ-A, OCQ-B');
  });

  it('formats previews and totals', () => {
    expect(messagePreview('  Hola\n\nequipo  ')).toBe('“Hola equipo”');
    expect(messagePreview('x'.repeat(300)).length).toBeLessThanOrEqual(162);
    expect(filePreview('plano.pdf')).toBe('Archivo: plano.pdf');
    expect(totalLabel(48_500_000n, 'MXN')).toBe('MXN 485,000.00');
  });
});
