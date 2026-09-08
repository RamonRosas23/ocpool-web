import { expect, test } from '@playwright/test';

test.skip(
  process.env.FOUNDATION_E2E !== '1',
  'Foundation E2E is opt-in because it requires Docker PostgreSQL',
);

test('reports a healthy database without exposing diagnostics', async ({ request }) => {
  const response = await request.get('/api/health');
  const body = await response.json();
  const serialized = JSON.stringify(body);

  expect(response.status()).toBe(200);
  expect(body.status).toBe('ok');
  expect(body.services.database).toBe('ok');
  expect(body.requestId).toEqual(expect.any(String));
  expect(serialized).not.toMatch(/stack|DATABASE_URL|SELECT|password/i);
});

test('reports readiness separately with no-store caching', async ({ request }) => {
  const response = await request.get('/api/ready');
  const body = await response.json();

  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(body.status).toBe('ok');
  expect(body.services.database).toBe('ok');
  expect(body.requestId).toEqual(expect.any(String));
  expect(JSON.stringify(body)).not.toMatch(/stack|DATABASE_URL|SELECT|password/i);
});
