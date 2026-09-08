import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/ready/route';

describe('GET /api/ready', () => {
  it('returns public readiness with no-store when PostgreSQL is available', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({ status: 'ok', services: { database: 'ok' } });
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toMatch(/DATABASE_URL|SELECT|stack|password/i);
  });
});
