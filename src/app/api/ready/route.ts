import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { checkDatabase } from '@/server/db/health';
import { buildReadinessResponse } from '@/server/db/readiness';

export async function GET() {
  const result = buildReadinessResponse(await checkDatabase(), randomUUID());
  const { httpStatus, ...body } = result;
  return NextResponse.json(body, {
    status: httpStatus,
    headers: { 'cache-control': 'no-store' },
  });
}
