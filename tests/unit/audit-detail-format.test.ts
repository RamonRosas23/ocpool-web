import { describe, expect, it } from 'vitest';
import { formatAuditDetail } from '@/lib/audit-detail-format';

describe('formatAuditDetail', () => {
  it('translates request and quote statuses into their Spanish labels', () => {
    expect(formatAuditDetail({ label: 'Estado anterior', value: 'EN_REVISION' })).toEqual({ label: 'Estado anterior', value: 'En revisión' });
    expect(formatAuditDetail({ label: 'Estado nuevo', value: 'COTIZACION_DISPONIBLE' })).toEqual({ label: 'Estado nuevo', value: 'Cotización disponible' });
    expect(formatAuditDetail({ label: 'Estado', value: 'ARCHIVED' })).toEqual({ label: 'Estado', value: 'Archivado' });
  });

  it('renders minor units as money and relabels the field', () => {
    expect(formatAuditDetail({ label: 'Importe mínimo', value: '15000' })).toEqual({ label: 'Importe', value: '$150.00' });
    expect(formatAuditDetail({ label: 'Importe mínimo', value: '123456789' })).toEqual({ label: 'Importe', value: '$1,234,567.89' });
  });

  it('renders byte sizes and durations for humans', () => {
    expect(formatAuditDetail({ label: 'Tamaño en bytes', value: '328177' })).toEqual({ label: 'Tamaño', value: '320.5 KB' });
    expect(formatAuditDetail({ label: 'Vigencia en segundos', value: '300' })).toEqual({ label: 'Vigencia del enlace', value: '5 min' });
  });

  it('formats ISO dates in the business timezone', () => {
    const detail = formatAuditDetail({ label: 'Vigente desde', value: '2026-09-25T06:00:00.000Z' }, 'America/Chihuahua');
    expect(detail.label).toBe('Vigente desde');
    // El abreviado del mes depende de la versión de ICU del runtime ("sep" / "sept").
    expect(detail.value).toMatch(/^25 sept? 2026$/u);
  });

  it('maps known enum values per field and leaves everything else untouched', () => {
    expect(formatAuditDetail({ label: 'Origen', value: 'STAFF_CREATED' })).toEqual({ label: 'Origen', value: 'Creada por staff' });
    expect(formatAuditDetail({ label: 'Resultado', value: 'INVITED' })).toEqual({ label: 'Resultado', value: 'Invitación enviada' });
    expect(formatAuditDetail({ label: 'Folio', value: 'OCQ-2026-000001' })).toEqual({ label: 'Folio', value: 'OCQ-2026-000001' });
    expect(formatAuditDetail({ label: 'Motivo', value: 'Ajuste de proveedor' })).toEqual({ label: 'Motivo', value: 'Ajuste de proveedor' });
  });
});
