import { encryptSecret, fingerprintToken, generateOpaqueToken, hashPassword, verifyPassword } from '@/server/auth/crypto';
import { checkAuthRateLimit } from '@/server/auth/rate-limit';
import { getSessionContext } from '@/server/auth/sessions';
import { createMfaEnrollment, unprotectMfaSecret, verifyTotpCode } from '@/server/auth/mfa';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';

const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$d428amtlatu8/oUHn3SpiQ$7RhDGCX3G4JoTAbujmHj2kFaCk8AzIDMkSc4A/g5yn4';

export type AuthRequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

export type AuthServiceDependencies = {
  prisma?: PrismaClient;
  now?: Date;
  tokenGenerator?: () => string;
  sessionTokenGenerator?: () => string;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bounded(value: string | null, maxLength: number): string | null {
  return value ? value.slice(0, maxLength) : null;
}

function identifierHash(value: string): string {
  return fingerprintToken(normalizeEmail(value));
}

async function recordAuthEvent(client: DbClient, input: {
  eventType: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE' | 'LOGOUT' | 'MAGIC_LINK_REQUEST' | 'MAGIC_LINK_CONSUMED' | 'PASSWORD_RESET_REQUEST' | 'PASSWORD_RESET_CONSUMED' | 'MFA_ENROLLED' | 'MFA_CHALLENGE' | 'MFA_FAILURE' | 'SESSION_CREATED' | 'SESSION_REVOKED';
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
  userId?: string | null;
  identifier?: string;
  context: AuthRequestContext;
  metadata?: Record<string, string | number | boolean>;
}): Promise<void> {
  await client.authEvent.create({
    data: {
      eventType: input.eventType,
      outcome: input.outcome,
      userId: input.userId ?? null,
      identifierHash: input.identifier ? identifierHash(input.identifier) : null,
      ipAddress: bounded(input.context.ipAddress, 64),
      userAgent: bounded(input.context.userAgent, 512),
      metadata: input.metadata,
    },
  });
}

async function createSessionInTransaction(client: Prisma.TransactionClient, input: {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  mfaVerified: boolean;
  now: Date;
  rawToken: string;
}): Promise<{ sessionId: string; rawToken: string; expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + readServerEnv().SESSION_TTL_HOURS * 60 * 60_000);
  const session = await client.session.create({
    data: {
      userId: input.userId,
      tokenHash: fingerprintToken(input.rawToken),
      expiresAt,
      lastSeenAt: input.now,
      mfaVerified: input.mfaVerified,
      ipAddress: bounded(input.ipAddress, 64),
      userAgent: bounded(input.userAgent, 512),
    },
  });
  return { sessionId: session.id, rawToken: input.rawToken, expiresAt };
}

async function createDeliveryToken(client: Prisma.TransactionClient, input: {
  userId: string;
  type: 'MAGIC_LINK' | 'PASSWORD_RESET';
  eventType: 'AUTH.CUSTOMER_MAGIC_LINK' | 'AUTH.EMPLOYEE_PASSWORD_RESET';
  context: AuthRequestContext;
  now: Date;
  rawToken: string;
}): Promise<{ tokenId: string; expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + readServerEnv().AUTH_TOKEN_TTL_MINUTES * 60_000);
  const token = await client.authToken.create({
    data: {
      userId: input.userId,
      type: input.type,
      tokenHash: fingerprintToken(input.rawToken),
      expiresAt,
      requestedIp: bounded(input.context.ipAddress, 64),
      userAgent: bounded(input.context.userAgent, 512),
    },
  });

  await client.outboxEvent.create({
    data: {
      eventType: input.eventType,
      aggregateType: 'USER',
      aggregateId: input.userId,
      payload: {
        tokenId: token.id,
        tokenCiphertext: encryptSecret(input.rawToken, readServerEnv().MFA_ENCRYPTION_KEY),
        tokenType: input.type,
      },
    },
  });

  return { tokenId: token.id, expiresAt };
}

async function isAllowed(rateLimit: { scope: string; key: string }, now: Date): Promise<boolean> {
  const env = readServerEnv();
  const decision = await checkAuthRateLimit({
    scope: rateLimit.scope,
    key: rateLimit.key,
    maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    windowMinutes: env.AUTH_RATE_LIMIT_WINDOW_MINUTES,
    now,
  });
  return decision.allowed;
}

export async function loginEmployee(input: {
  email: string;
  password: string;
  mfaCode?: string;
  context: AuthRequestContext;
}, dependencies: AuthServiceDependencies = {}): Promise<
  | { ok: true; userId: string; sessionId: string; rawToken: string; expiresAt: Date }
  | { ok: false }
> {
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const email = normalizeEmail(input.email);
  const allowedByEmail = await isAllowed({ scope: 'employee-login-email', key: email }, now);
  const allowedByIp = input.context.ipAddress
    ? await isAllowed({ scope: 'employee-login-ip', key: input.context.ipAddress }, now)
    : true;

  const user = await prisma.user.findUnique({
    where: { emailNormalized: email },
    include: { roles: { include: { role: true } } },
  });
  const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, input.password);
  const eligible = Boolean(user && user.type === 'EMPLOYEE' && user.status === 'ACTIVE' && user.passwordHash && passwordOk);
  const isAdmin = Boolean(user?.roles.some(({ role }) => role.key === 'admin'));
  const requiresMfa = Boolean(user?.mfaRequired || isAdmin);
  let acceptedMfaCounter: number | null = null;

  if (eligible && requiresMfa) {
    if (!input.mfaCode || !user?.mfaSecretCiphertext) {
      await recordAuthEvent(prisma, { eventType: 'MFA_CHALLENGE', outcome: 'DENIED', userId: user?.id, identifier: email, context: input.context });
      return { ok: false };
    }
    try {
      const secret = unprotectMfaSecret(user.mfaSecretCiphertext, readServerEnv().MFA_ENCRYPTION_KEY);
      acceptedMfaCounter = verifyTotpCode(secret, input.mfaCode, now.getTime(), user.mfaLastAcceptedCounter);
    } catch {
      acceptedMfaCounter = null;
    }
    if (acceptedMfaCounter === null) {
      await recordAuthEvent(prisma, { eventType: 'MFA_FAILURE', outcome: 'DENIED', userId: user.id, identifier: email, context: input.context });
      return { ok: false };
    }
  }

  if (!eligible || !user || !allowedByEmail || !allowedByIp) {
    await recordAuthEvent(prisma, {
      eventType: 'LOGIN_FAILURE',
      outcome: 'DENIED',
      userId: user?.id,
      identifier: email,
      context: input.context,
      metadata: { reason: 'generic_failure' },
    });
    return { ok: false };
  }

  const rawToken = (dependencies.sessionTokenGenerator ?? generateOpaqueToken)();
  const result = await prisma.$transaction(async (transaction) => {
    if (acceptedMfaCounter !== null) {
      const updated = await transaction.user.updateMany({
        where: {
          id: user.id,
          OR: [{ mfaLastAcceptedCounter: null }, { mfaLastAcceptedCounter: { lt: acceptedMfaCounter } }],
        },
        data: { mfaLastAcceptedCounter: acceptedMfaCounter },
      });
      if (updated.count !== 1) return null;
    }

    const session = await createSessionInTransaction(transaction, {
      userId: user.id,
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      mfaVerified: requiresMfa,
      now,
      rawToken,
    });
    await recordAuthEvent(transaction, { eventType: 'LOGIN_SUCCESS', outcome: 'SUCCESS', userId: user.id, identifier: email, context: input.context, metadata: { mfaVerified: requiresMfa } });
    await recordAuthEvent(transaction, { eventType: 'SESSION_CREATED', outcome: 'SUCCESS', userId: user.id, context: input.context, metadata: { sessionId: session.sessionId } });
    return session;
  });

  if (!result) return { ok: false };
  return { ok: true, userId: user.id, ...result };
}

export async function requestCustomerMagicLink(input: { email: string; context: AuthRequestContext }, dependencies: AuthServiceDependencies = {}): Promise<void> {
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const email = normalizeEmail(input.email);
  const allowedByEmail = await isAllowed({ scope: 'customer-magic-link-email', key: email }, now);
  const allowedByIp = input.context.ipAddress
    ? await isAllowed({ scope: 'customer-magic-link-ip', key: input.context.ipAddress }, now)
    : true;
  if (!allowedByEmail || !allowedByIp) return;

  const user = await prisma.user.findUnique({ where: { emailNormalized: email }, include: { client: true } });
  if (!user || user.type !== 'CUSTOMER' || user.status !== 'ACTIVE' || user.client?.status !== 'ACTIVE') {
    await recordAuthEvent(prisma, { eventType: 'MAGIC_LINK_REQUEST', outcome: 'DENIED', identifier: email, context: input.context });
    return;
  }

  const rawToken = (dependencies.tokenGenerator ?? generateOpaqueToken)();
  await prisma.$transaction(async (transaction) => {
    const delivery = await createDeliveryToken(transaction, {
      userId: user.id,
      type: 'MAGIC_LINK',
      eventType: 'AUTH.CUSTOMER_MAGIC_LINK',
      context: input.context,
      now,
      rawToken,
    });
    await recordAuthEvent(transaction, { eventType: 'MAGIC_LINK_REQUEST', outcome: 'SUCCESS', userId: user.id, identifier: email, context: input.context, metadata: { tokenId: delivery.tokenId } });
  });
}

export async function consumeCustomerMagicLink(rawToken: string, context: AuthRequestContext, dependencies: AuthServiceDependencies = {}): Promise<
  | { ok: true; userId: string; sessionId: string; rawToken: string; expiresAt: Date }
  | { ok: false }
> {
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  if (!rawToken || rawToken.length < 40) return { ok: false };
  if (context.ipAddress && !(await isAllowed({ scope: 'customer-magic-link-consume-ip', key: context.ipAddress }, now))) return { ok: false };

  const sessionRawToken = (dependencies.sessionTokenGenerator ?? generateOpaqueToken)();
  const result = await prisma.$transaction(async (transaction) => {
    const token = await transaction.authToken.findUnique({ where: { tokenHash: fingerprintToken(rawToken) }, include: { user: { include: { client: true } } } });
    if (!token || token.type !== 'MAGIC_LINK' || token.consumedAt || token.expiresAt <= now) return null;
    const consumed = await transaction.authToken.updateMany({ where: { id: token.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1 || token.user.type !== 'CUSTOMER' || token.user.status !== 'ACTIVE' || token.user.client?.status !== 'ACTIVE') return null;

    const session = await createSessionInTransaction(transaction, { userId: token.userId, ipAddress: context.ipAddress, userAgent: context.userAgent, mfaVerified: true, now, rawToken: sessionRawToken });
    await recordAuthEvent(transaction, { eventType: 'MAGIC_LINK_CONSUMED', outcome: 'SUCCESS', userId: token.userId, context, metadata: { tokenId: token.id } });
    await recordAuthEvent(transaction, { eventType: 'SESSION_CREATED', outcome: 'SUCCESS', userId: token.userId, context, metadata: { sessionId: session.sessionId } });
    return { userId: token.userId, ...session };
  });

  return result ? { ok: true, ...result } : { ok: false };
}

export async function requestPasswordRecovery(input: { email: string; context: AuthRequestContext }, dependencies: AuthServiceDependencies = {}): Promise<void> {
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const email = normalizeEmail(input.email);
  const allowedByEmail = await isAllowed({ scope: 'password-recovery-email', key: email }, now);
  const allowedByIp = input.context.ipAddress
    ? await isAllowed({ scope: 'password-recovery-ip', key: input.context.ipAddress }, now)
    : true;
  if (!allowedByEmail || !allowedByIp) return;

  const user = await prisma.user.findUnique({ where: { emailNormalized: email } });
  if (!user || user.type !== 'EMPLOYEE' || user.status !== 'ACTIVE') {
    await recordAuthEvent(prisma, { eventType: 'PASSWORD_RESET_REQUEST', outcome: 'DENIED', identifier: email, context: input.context });
    return;
  }

  const rawToken = (dependencies.tokenGenerator ?? generateOpaqueToken)();
  await prisma.$transaction(async (transaction) => {
    const delivery = await createDeliveryToken(transaction, { userId: user.id, type: 'PASSWORD_RESET', eventType: 'AUTH.EMPLOYEE_PASSWORD_RESET', context: input.context, now, rawToken });
    await recordAuthEvent(transaction, { eventType: 'PASSWORD_RESET_REQUEST', outcome: 'SUCCESS', userId: user.id, identifier: email, context: input.context, metadata: { tokenId: delivery.tokenId } });
  });
}

export async function consumePasswordRecovery(input: { rawToken: string; newPassword: string; context: AuthRequestContext }, dependencies: AuthServiceDependencies = {}): Promise<boolean> {
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  if (!input.rawToken || input.rawToken.length < 40) return false;
  if (input.context.ipAddress && !(await isAllowed({ scope: 'password-recovery-consume-ip', key: input.context.ipAddress }, now))) return false;
  const passwordHash = await hashPassword(input.newPassword);

  return prisma.$transaction(async (transaction) => {
    const token = await transaction.authToken.findUnique({ where: { tokenHash: fingerprintToken(input.rawToken) } });
    if (!token || token.type !== 'PASSWORD_RESET' || token.consumedAt || token.expiresAt <= now) return false;
    const consumed = await transaction.authToken.updateMany({ where: { id: token.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) return false;
    const user = await transaction.user.findUnique({ where: { id: token.userId } });
    if (!user || user.type !== 'EMPLOYEE' || user.status !== 'ACTIVE') return false;
    await transaction.user.update({ where: { id: user.id }, data: { passwordHash } });
    await transaction.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    await recordAuthEvent(transaction, { eventType: 'PASSWORD_RESET_CONSUMED', outcome: 'SUCCESS', userId: user.id, context: input.context, metadata: { tokenId: token.id } });
    return true;
  });
}

export async function logout(rawToken: string, context: AuthRequestContext, dependencies: AuthServiceDependencies = {}): Promise<void> {
  const prisma = dependencies.prisma ?? getPrisma();
  const session = await getSessionContext(rawToken, dependencies);
  if (!session) return;
  const now = dependencies.now ?? new Date();
  await prisma.$transaction(async (transaction) => {
    await transaction.session.updateMany({ where: { id: session.sessionId, revokedAt: null }, data: { revokedAt: now } });
    await recordAuthEvent(transaction, { eventType: 'LOGOUT', outcome: 'SUCCESS', userId: session.actor.userId, context });
    await recordAuthEvent(transaction, { eventType: 'SESSION_REVOKED', outcome: 'SUCCESS', userId: session.actor.userId, context, metadata: { sessionId: session.sessionId } });
  });
}

export async function currentSessionActor(rawToken: string, dependencies: AuthServiceDependencies = {}) {
  return getSessionContext(rawToken, dependencies);
}

export function generateMfaEnrollment(accountLabel: string) {
  return createMfaEnrollment({ accountLabel });
}
