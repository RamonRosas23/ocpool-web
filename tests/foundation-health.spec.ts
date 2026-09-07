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
