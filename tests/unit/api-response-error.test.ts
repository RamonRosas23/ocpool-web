import { describe, expect, it } from 'vitest';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('readApiResponse', () => {
  it('classifies a cross-origin CSRF rejection as forbidden even though its message lacks the legacy substrings (U1 parte 2)', async () => {
    const result = await readApiResponse(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Solicitud no permitida.' } }), 'fallback');
    expect(result).toMatchObject({ ok: false, kind: 'forbidden', message: 'Solicitud no permitida.' });
  });

  it('classifies success, not-found and transient failures by real HTTP status', async () => {
    await expect(readApiResponse<{ items: unknown[] }>(jsonResponse(200, { items: [] }), 'fallback')).resolves.toEqual({ ok: true, data: { items: [] } });
    await expect(readApiResponse(jsonResponse(401, {}), 'fallback')).resolves.toMatchObject({ ok: false, kind: 'forbidden' });
    await expect(readApiResponse(jsonResponse(404, {}), 'No encontrado.')).resolves.toMatchObject({ ok: false, kind: 'not_found', message: 'No encontrado.' });
    await expect(readApiResponse(jsonResponse(500, {}), 'fallback')).resolves.toMatchObject({ ok: false, kind: 'transient' });
  });

  it('readApiResponseOrThrow rejects with the classified message on failure', async () => {
    await expect(readApiResponseOrThrow(jsonResponse(404, {}), 'No encontrado.')).rejects.toThrow('No encontrado.');
    await expect(readApiResponseOrThrow<{ ok: true }>(jsonResponse(200, { ok: true }), 'fallback')).resolves.toEqual({ ok: true });
  });
});
