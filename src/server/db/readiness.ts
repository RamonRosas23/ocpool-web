import type { DatabaseHealth } from '@/server/db/health';

export type ReadinessResponse = {
  status: 'ok' | 'degraded';
  requestId: string;
  services: { database: DatabaseHealth['status'] };
  httpStatus: 200 | 503;
};

export function buildReadinessResponse(database: DatabaseHealth, requestId: string): ReadinessResponse {
  const ready = database.status === 'ok';
  return {
    status: ready ? 'ok' : 'degraded',
    requestId,
    services: { database: database.status },
    httpStatus: ready ? 200 : 503,
  };
}
