import { describe, expect, it } from 'vitest';
import { checkAuthRateLimit, checkAuthRateLimitIfKeyAvailable, type RateLimitBucket, type RateLimitRepository } from '@/server/auth/rate-limit';

function createRepository(): RateLimitRepository {
  const buckets = new Map<string, RateLimitBucket>();
  return {
    async get(scope, keyHash) {
      return buckets.get(`${scope}:${keyHash}`) ?? null;
    },
    async save(scope, keyHash, bucket) {
      buckets.set(`${scope}:${keyHash}`, bucket);
    },
  };
}

describe('authentication rate limits', () => {
  it('allows the configured attempts and blocks subsequent attempts', async () => {
    const repository = createRepository();
    const base = new Date('2026-01-01T00:00:00.000Z');
    const options = { scope: 'employee-login', key: 'admin@example.test', maxAttempts: 3, windowMinutes: 15, now: base, repository };

    await expect(checkAuthRateLimit(options)).resolves.toMatchObject({ allowed: true, remaining: 2 });
    await expect(checkAuthRateLimit({ ...options, now: new Date(base.getTime() + 1_000) })).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(checkAuthRateLimit({ ...options, now: new Date(base.getTime() + 2_000) })).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(checkAuthRateLimit({ ...options, now: new Date(base.getTime() + 3_000) })).resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  it('resets the bucket after the fixed window', async () => {
    const repository = createRepository();
    const base = new Date('2026-01-01T00:00:00.000Z');
    const options = { scope: 'customer-link', key: 'unknown@example.test', maxAttempts: 1, windowMinutes: 15, repository };

    await expect(checkAuthRateLimit({ ...options, now: base })).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(checkAuthRateLimit({ ...options, now: new Date(base.getTime() + 14 * 60_000) })).resolves.toMatchObject({ allowed: false });
    await expect(checkAuthRateLimit({ ...options, now: new Date(base.getTime() + 15 * 60_000) })).resolves.toMatchObject({ allowed: true, remaining: 0 });
  });

  it('does not create a shared bucket when a trusted client key is unavailable', async () => {
    const repository = createRepository();
    const decision = await checkAuthRateLimitIfKeyAvailable({
      scope: 'employee-login-ip',
      key: null,
      maxAttempts: 1,
      windowMinutes: 15,
      repository,
    });

    expect(decision).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: null });
    expect(await repository.get('employee-login-ip', 'unknown-client')).toBeNull();
  });
});
