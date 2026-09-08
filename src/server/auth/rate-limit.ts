import { randomUUID } from 'node:crypto';
import { fingerprintToken } from '@/server/auth/crypto';
import { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/server/db/client';

export type RateLimitBucket = {
  windowStarted: Date;
  attempts: number;
  blockedUntil: Date | null;
};

export type RateLimitRepository = {
  get(scope: string, keyHash: string): Promise<RateLimitBucket | null>;
  save(scope: string, keyHash: string, bucket: RateLimitBucket): Promise<void>;
};

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number | null;
};

type RateLimitInput = {
  scope: string;
  key: string;
  maxAttempts: number;
  windowMinutes: number;
  now?: Date;
  repository?: RateLimitRepository;
};

type OptionalRateLimitInput = Omit<RateLimitInput, 'key'> & { key: string | null };

function secondsUntil(date: Date, now: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));
}

function evaluateBucket(
  current: RateLimitBucket | null,
  maxAttempts: number,
  windowMs: number,
  now: Date,
): { bucket: RateLimitBucket; decision: RateLimitDecision } {
  if (!current || now.getTime() >= current.windowStarted.getTime() + windowMs) {
    const windowStarted = now;
    const blockedUntil = maxAttempts === 1 ? new Date(now.getTime() + windowMs) : null;
    return {
      bucket: { windowStarted, attempts: 1, blockedUntil },
      decision: { allowed: true, remaining: Math.max(maxAttempts - 1, 0), retryAfterSeconds: null },
    };
  }

  if (current.blockedUntil && now < current.blockedUntil) {
    return {
      bucket: current,
      decision: { allowed: false, remaining: 0, retryAfterSeconds: secondsUntil(current.blockedUntil, now) },
    };
  }

  const attempts = current.attempts + 1;
  const blockedUntil = attempts >= maxAttempts
    ? new Date(current.windowStarted.getTime() + windowMs)
    : null;
  return {
    bucket: { windowStarted: current.windowStarted, attempts, blockedUntil },
    decision: { allowed: true, remaining: Math.max(maxAttempts - attempts, 0), retryAfterSeconds: null },
  };
}

async function checkDatabaseRateLimit(input: {
  scope: string;
  keyHash: string;
  maxAttempts: number;
  windowMs: number;
  now: Date;
}): Promise<RateLimitDecision> {
  const prisma = getPrisma();
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "auth_rate_limits" ("id", "scope", "keyHash", "windowStarted", "attempts", "blockedUntil", "updatedAt")
      VALUES (${randomUUID()}, ${input.scope}, ${input.keyHash}, ${input.now}, 0, NULL, ${input.now})
      ON CONFLICT ("scope", "keyHash") DO NOTHING
    `);

    const rows = await transaction.$queryRaw<RateLimitBucket[]>(Prisma.sql`
      SELECT "windowStarted", "attempts", "blockedUntil"
      FROM "auth_rate_limits"
      WHERE "scope" = ${input.scope} AND "keyHash" = ${input.keyHash}
      FOR UPDATE
    `);
    const current = rows[0] ?? null;
    const result = evaluateBucket(current, input.maxAttempts, input.windowMs, input.now);
    await transaction.authRateLimit.update({
      where: { scope_keyHash: { scope: input.scope, keyHash: input.keyHash } },
      data: result.bucket,
    });
    return result.decision;
  });
}

export async function checkAuthRateLimit(input: {
  scope: string;
  key: string;
  maxAttempts: number;
  windowMinutes: number;
  now?: Date;
  repository?: RateLimitRepository;
}): Promise<RateLimitDecision> {
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) throw new Error('Invalid rate-limit maximum.');
  if (!Number.isInteger(input.windowMinutes) || input.windowMinutes < 1) throw new Error('Invalid rate-limit window.');

  const now = input.now ?? new Date();
  const keyHash = fingerprintToken(input.key.trim().toLowerCase().slice(0, 320));
  const windowMs = input.windowMinutes * 60_000;
  if (!input.repository) {
    return checkDatabaseRateLimit({ scope: input.scope, keyHash, maxAttempts: input.maxAttempts, windowMs, now });
  }

  const current = await input.repository.get(input.scope, keyHash);
  const result = evaluateBucket(current, input.maxAttempts, windowMs, now);
  if (result.decision.allowed || !current?.blockedUntil) {
    await input.repository.save(input.scope, keyHash, result.bucket);
  }
  return result.decision;
}

export async function checkAuthRateLimitIfKeyAvailable(input: OptionalRateLimitInput): Promise<RateLimitDecision> {
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) throw new Error('Invalid rate-limit maximum.');
  if (!Number.isInteger(input.windowMinutes) || input.windowMinutes < 1) throw new Error('Invalid rate-limit window.');
  if (!input.key) return { allowed: true, remaining: input.maxAttempts, retryAfterSeconds: null };
  return checkAuthRateLimit({ ...input, key: input.key });
}
