import { describe, expect, it } from 'vitest';
import { assertSameOrigin } from '@/server/auth/csrf';
import { emailBodySchema, parseBody, requestContext } from '@/server/auth/http';

describe('same-origin protection', () => {
  it('accepts the configured application origin and rejects foreign origins', () => {
    const request = new Request('http://localhost:3000/api/auth/session', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', cookie: 'ocpool_session=opaque' },
    });

    expect(() => assertSameOrigin(request, 'http://localhost:3000')).not.toThrow();
    expect(() => assertSameOrigin(new Request(request, { headers: { origin: 'https://attacker.example', cookie: 'ocpool_session=opaque' } }), 'http://localhost:3000')).toThrow();
  });

  it('rejects malformed origins and missing origins on cookie-authenticated mutations', () => {
    expect(() => assertSameOrigin(new Request('http://localhost:3000/api/auth/session', {
      method: 'POST',
      headers: { origin: 'not a valid origin', cookie: 'ocpool_session=opaque' },
    }), 'http://localhost:3000')).toThrow();
    expect(() => assertSameOrigin(new Request('http://localhost:3000/api/auth/session', {
      method: 'POST',
      headers: { cookie: 'ocpool_session=opaque' },
    }), 'http://localhost:3000')).toThrow();
  });

  it('allows an origin-less server-to-server request without a session cookie', () => {
    expect(() => assertSameOrigin(new Request('http://localhost:3000/api/auth/customer/request-link', { method: 'POST' }), 'http://localhost:3000')).not.toThrow();
  });

  it('requires JSON bodies and does not trust forwarding headers by default', async () => {
    await expect(parseBody(new Request('http://localhost:3000', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }), emailBodySchema)).rejects.toThrow();
    await expect(parseBody(new Request('http://localhost:3000', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'content-length': '20000' } }), emailBodySchema)).rejects.toThrow();
    expect(requestContext(new Request('http://localhost:3000', { headers: { 'x-forwarded-for': '203.0.113.10' } }) as Request & { cookies: never }).ipAddress).toBeNull();
  });
});
