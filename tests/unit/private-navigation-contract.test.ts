import { describe, expect, it } from 'vitest';
import { visibleStaffNavigation } from '@/components/private/navigation';

describe('private navigation capability contract', () => {
  it('only exposes staff destinations backed by server capabilities', () => {
    expect(visibleStaffNavigation({ metricsRead: true, requestsRead: true, quotesRead: true, catalogRead: true, notificationsRead: true, auditRead: false }).map((item) => item.key)).toEqual([
      'dashboard',
      'requests',
      'quotes',
      'catalog',
      'notifications',
    ]);
    expect(visibleStaffNavigation({ requestsRead: true }).map((item) => item.href)).toEqual(['/staff/requests']);
    expect(visibleStaffNavigation({ metricsRead: true, auditRead: true }).map((item) => item.key)).toEqual(['dashboard', 'audit']);
  });

  it('does not turn an absent capability into access', () => {
    expect(visibleStaffNavigation({}).map((item) => item.href)).toEqual([]);
    expect(visibleStaffNavigation({ auditRead: false, notificationsRead: false })).toEqual([]);
  });
});
