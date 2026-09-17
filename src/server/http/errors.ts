import { NextResponse } from 'next/server.js';
import { logger } from '@/server/logging/logger';

export type PublicErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'MFA_REQUIRED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: PublicErrorCode,
    public readonly publicMessage: string,
    public readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(publicMessage, options);
    this.name = 'AppError';
  }
}

type PublicErrorBody = {
  error: {
    code: PublicErrorCode;
    message: string;
    requestId: string;
  };
};

function sanitizeLogText(value: string): string {
  return value
    .replace(/DATABASE_URL=[^;\s]+/gi, 'DATABASE_URL=[REDACTED]')
    .replace(/(password|token|authorization|cookie)=([^;\s]+)/gi, '$1=[REDACTED]');
}

export function toErrorResponse(error: unknown, requestId: string): NextResponse<PublicErrorBody> {
  if (error instanceof AppError) {
    logger.warn({ requestId, code: error.code, status: error.status }, 'Application error');
    return NextResponse.json({
      error: {
        code: error.code,
        message: error.publicMessage,
        requestId,
      },
    }, { status: error.status, headers: { 'cache-control': 'no-store' } });
  }

  logger.error({
    requestId,
    error: error instanceof Error
      ? {
        name: error.name,
        message: sanitizeLogText(error.message),
        stack: error.stack ? sanitizeLogText(error.stack) : undefined,
      }
      : { type: typeof error },
  }, 'Unhandled application error');

  return NextResponse.json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error inesperado.',
      requestId,
    },
  }, { status: 500, headers: { 'cache-control': 'no-store' } });
}
