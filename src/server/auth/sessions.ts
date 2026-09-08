import { AUTH_SESSION_COOKIE } from '@/server/auth/constants';
import { compareToken, fingerprintToken, generateOpaqueToken } from '@/server/auth/crypto';
import type { Actor, SessionCookieOptions } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import type { PrismaClient } from '@/generated/prisma/client';

type SessionDependencies = {
  prisma?: PrismaClient;
  now?: Date;
  tokenGenerator?: () => string;
};

export async function createSession(input: {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  mfaVerified?: boolean;
}, dependencies: SessionDependencies = {}): Promise<{ sessionId: string; rawToken: string; expiresAt: Date }> {
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const rawToken = (dependencies.tokenGenerator ?? generateOpaqueToken)();
  const expiresAt = new Date(now.getTime() + readServerEnv().SESSION_TTL_HOURS * 60 * 60_000);
  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: fingerprintToken(rawToken),
      expiresAt,
      lastSeenAt: now,
      mfaVerified: input.mfaVerified ?? false,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });

  return { sessionId: session.id, rawToken, expiresAt };
}

export async function getSessionContext(rawToken: string, dependencies: SessionDependencies = {}): Promise<{ sessionId: string; actor: Actor } | null> {
  if (!rawToken || rawToken.length < 40) return null;

  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const session = await transaction.session.findUnique({
      where: { tokenHash: fingerprintToken(rawToken) },
      include: {
        user: {
          include: {
            client: { select: { status: true } },
            roles: {
              include: {
                role: { include: { permissions: { include: { permission: true } } } },
              },
            },
          },
        },
      },
    });

    if (!session || !compareToken(rawToken, session.tokenHash)) return null;
    if (session.revokedAt || session.expiresAt <= now) return null;
    if (session.user.status !== 'ACTIVE') return null;
    if (session.user.type === 'CUSTOMER' && session.user.clientId && session.user.client?.status !== 'ACTIVE') return null;
    const requiresMfa = session.user.type === 'EMPLOYEE'
      && (session.user.mfaRequired || session.user.roles.some(({ role }) => role.key === 'admin'));
    if (requiresMfa && !session.mfaVerified) return null;

    const touched = await transaction.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastSeenAt: now },
    });
    if (touched.count !== 1) return null;

    const permissionKeys = new Set(
      session.user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)),
    );

    return {
      sessionId: session.id,
      actor: {
        userId: session.user.id,
        type: session.user.type,
        clientId: session.user.clientId,
        permissionKeys,
        mfaVerified: session.mfaVerified,
      },
    };
  });
}

export async function getActorFromSession(rawToken: string, dependencies: SessionDependencies = {}): Promise<Actor | null> {
  return (await getSessionContext(rawToken, dependencies))?.actor ?? null;
}

export async function revokeSession(sessionId: string, _reason: string, dependencies: SessionDependencies = {}): Promise<void> {
  const prisma = dependencies.prisma ?? getPrisma();
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: dependencies.now ?? new Date() } });
}

export async function revokeAllUserSessions(userId: string, dependencies: SessionDependencies = {}): Promise<void> {
  const prisma = dependencies.prisma ?? getPrisma();
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: dependencies.now ?? new Date() } });
}

export function createSessionCookie(rawToken: string, expiresAt: Date, now = new Date(), secure = process.env.NODE_ENV === 'production'): SessionCookieOptions {
  return {
    name: AUTH_SESSION_COOKIE,
    value: rawToken,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: expiresAt,
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

export function clearSessionCookie(secure = process.env.NODE_ENV === 'production'): SessionCookieOptions {
  return createSessionCookie('', new Date(0), new Date(), secure);
}

export function serializeSessionCookie(rawToken: string, expiresAt: Date, now = new Date(), secure = process.env.NODE_ENV === 'production'): string {
  const cookie = createSessionCookie(rawToken, expiresAt, now, secure);
  return `${cookie.name}=${encodeURIComponent(cookie.value)}; Path=/; Max-Age=${cookie.maxAge}; Expires=${cookie.expires.toUTCString()}; HttpOnly; SameSite=Lax${cookie.secure ? '; Secure' : ''}`;
}
