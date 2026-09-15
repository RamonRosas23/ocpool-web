import { describe, expect, it } from 'vitest';
import { requestWorkspaceNotificationPath } from '@/server/modules/notifications/event-resolver';
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
});
