import { describe, expect, it } from 'vitest';
import { serializePortalMoney } from '@/server/modules/client-portal/service';
import { isCustomerVisibleQuoteVersionStatus } from '@/server/modules/quotes/customer-visibility';

describe('client portal projection contracts', () => {
  it('serializes minor units without converting through JavaScript number', () => {
    expect(serializePortalMoney(9_999_999_999_999_999n)).toBe('9999999999999999');
    expect(serializePortalMoney(0n)).toBe('0');
    expect(serializePortalMoney(null)).toBeNull();
  });

  it('never treats an internal review as a customer-visible quote version', () => {
    expect(isCustomerVisibleQuoteVersionStatus('ENVIADA')).toBe(true);
    expect(isCustomerVisibleQuoteVersionStatus('EN_NEGOCIACION')).toBe(true);
    expect(isCustomerVisibleQuoteVersionStatus('EN_REVISION')).toBe(false);
    expect(isCustomerVisibleQuoteVersionStatus('BORRADOR')).toBe(false);
  });
});
