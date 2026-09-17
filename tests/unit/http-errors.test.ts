import { describe, expect, it } from 'vitest';
import { AppError, toErrorResponse } from '@/server/http/errors';

describe('toErrorResponse', () => {
  it('maps an internal exception to a safe public envelope', async () => {
    const response = toErrorResponse(
      new Error('DATABASE_URL=postgresql://user:password@example.test/app; SELECT * FROM secrets'),
      'request-123',
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error inesperado.',
        requestId: 'request-123',
      },
    });
    expect(serialized).not.toContain('DATABASE_URL');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('stack');
  });

  it.each([
    ['VALIDATION_ERROR', 'Datos inválidos.', 400],
    ['FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403],
    ['NOT_FOUND', 'No encontramos el recurso solicitado.', 404],
    ['MFA_REQUIRED', 'Ingresa el código de tu app de autenticación.', 401],
  ] as const)('preserves the public contract for %s', async (code, message, status) => {
    const response = toErrorResponse(new AppError(code, message, status), 'request-456');
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: { code, message, requestId: 'request-456' },
    });
  });
});
