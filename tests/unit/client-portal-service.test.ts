import { describe, expect, it } from 'vitest';
import { serializePortalMoney } from '@/server/modules/client-portal/service';

describe('client portal projection contracts', () => {
  it('serializes minor units without converting through JavaScript number', () => {
    expect(serializePortalMoney(9_999_999_999_999_999n)).toBe('9999999999999999');
    expect(serializePortalMoney(0n)).toBe('0');
    expect(serializePortalMoney(null)).toBeNull();
  });
});
