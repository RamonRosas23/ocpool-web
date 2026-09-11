import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { checkDatabase } from '@/server/db/health';
import { logger } from '@/server/logging/logger';

export async function GET() {
  const requestId = randomUUID();
  const database = await checkDatabase();
  const headers = { 'cache-control': 'no-store' };

  if (database.status !== 'ok') {
    logger.error({ requestId, database: database.status }, 'Health check failed');
    return NextResponse.json({
      status: 'degraded',
      requestId,
      services: { database: database.status },
    }, { status: 503, headers });
  }

  return NextResponse.json({
    status: 'ok',
    requestId,
    services: { database: database.status },
  }, { headers });
}
