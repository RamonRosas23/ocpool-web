import { describe, expect, it } from 'vitest';
import { customerContext, requestWorkspaceNotificationPath } from '@/server/modules/notifications/event-resolver';
import { DEFAULT_COMMERCIAL_V2_FLAGS } from '@/server/flags/commercial-v2';

describe('notification workspace links', () => {
  it('keeps the legacy queue as the safe fallback when the workspace is not active', () => {
    expect(requestWorkspaceNotificationPath('00000000-0000-4000-8000-000000000001', 'conversation', DEFAULT_COMMERCIAL_V2_FLAGS)).toBe('/staff/requests');
  });

  it('deep-links staff notifications only when both workspace flags are active', () => {
    expect(requestWorkspaceNotificationPath('00000000-0000-4000-8000-000000000001', 'conversation', {
      ...DEFAULT_COMMERCIAL_V2_FLAGS,
      commercialWorkspaceV2: true,
      requestWorkspaceV2: true,
    })).toBe('/staff/requests/00000000-0000-4000-8000-000000000001?tab=conversation');
  });

  it('deep-links a known customer to the exact request instead of the bare portal root (D2-06)', () => {
    const recipient = { userId: 'user-1', email: 'customer@example.test', displayName: 'Cliente', audience: 'CUSTOMER' as const };
    expect(customerContext(recipient, '00000000-0000-4000-8000-000000000001')).toMatchObject({ actionPath: '/portal?request=00000000-0000-4000-8000-000000000001' });
    expect(customerContext(recipient)).toMatchObject({ actionPath: '/portal' });
  });

  it('never deep-links a contact without a portal account — sends them to request access instead', () => {
    const recipient = { userId: null, email: 'no-account@example.test', displayName: 'Cliente sin cuenta', audience: 'CUSTOMER' as const };
    expect(customerContext(recipient, '00000000-0000-4000-8000-000000000001')).toMatchObject({ actionPath: '/portal/access', actionLabel: 'Solicitar acceso' });
  });
});
