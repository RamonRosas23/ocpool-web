import { describe, expect, it } from 'vitest';
import { createSessionCookie, serializeSessionCookie } from '@/server/auth/sessions';

describe('session cookie policy', () => {
  it('sets an opaque HttpOnly Lax cookie with explicit expiry', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date('2026-01-02T00:00:00.000Z');
    const cookie = createSessionCookie('opaque-token', expiresAt, now, true);
    const serialized = serializeSessionCookie('opaque-token', expiresAt, now, true);

    expect(cookie).toMatchObject({
      name: 'ocpool_session',
      value: 'opaque-token',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 86_400,
    });
    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('SameSite=Lax');
    expect(serialized).toContain('Secure');
    expect(serialized).toContain('Max-Age=86400');
  });
});
