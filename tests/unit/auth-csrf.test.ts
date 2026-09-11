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

  it('accepts both official OCPOOL hosts without accepting other origins', () => {
    expect(() => assertSameOrigin(new Request('https://ocpool.com.mx/api/quote-requests', {
      method: 'POST',
      headers: { origin: 'https://www.ocpool.com.mx' },
    }), 'https://ocpool.com.mx')).not.toThrow();
    expect(() => assertSameOrigin(new Request('https://www.ocpool.com.mx/api/quote-requests', {
      method: 'POST',
      headers: { origin: 'https://ocpool.com.mx' },
    }), 'https://www.ocpool.com.mx')).not.toThrow();
    expect(() => assertSameOrigin(new Request('https://ocpool.com.mx/api/quote-requests', {
      method: 'POST',
      headers: { origin: 'http://ocpool.com.mx' },
    }), 'https://ocpool.com.mx')).toThrow();
  });

  it('requires JSON bodies and does not trust forwarding headers by default', async () => {
    await expect(parseBody(new Request('http://localhost:3000', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }), emailBodySchema)).rejects.toThrow();
    await expect(parseBody(new Request('http://localhost:3000', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'content-length': '20000' } }), emailBodySchema)).rejects.toThrow();
    expect(requestContext(new Request('http://localhost:3000', { headers: { 'x-forwarded-for': '203.0.113.10' } })).ipAddress).toBeNull();
  });

  it('stops reading a chunked body as soon as it exceeds the byte limit', async () => {
    const encoder = new TextEncoder();
    const firstChunk = encoder.encode('{"email":"client@example.com","padding":"');
    const oversizedChunk = encoder.encode(`${'x'.repeat(17_000)}"}`);
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(firstChunk);
          return;
        }
        if (pullCount === 2) {
          controller.enqueue(oversizedChunk);
          return;
        }
        throw new Error('body was read past the limit');
      },
    });

    await expect(parseBody(new Request('http://localhost:3000', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }), emailBodySchema)).rejects.toThrow();
    expect(pullCount).toBe(2);
  });
});
