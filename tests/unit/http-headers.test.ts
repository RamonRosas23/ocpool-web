import { describe, expect, it } from 'vitest';
import { getSecurityHeaders } from '@/server/security/http-headers';

describe('getSecurityHeaders', () => {
  it('returns defensive headers without HSTS for local HTTP', () => {
    const headers = getSecurityHeaders({ production: false, https: false });

    expect(headers).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
    });
    expect(headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('adds HSTS only for production HTTPS', () => {
    expect(getSecurityHeaders({ production: true, https: true })['Strict-Transport-Security'])
      .toBe('max-age=63072000; includeSubDomains; preload');
  });
});
