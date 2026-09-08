import { fingerprintToken, generateOpaqueToken } from '@/server/auth/crypto';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import type { PrismaClient } from '@/generated/prisma/client';

export type AuthTokenType = 'MAGIC_LINK' | 'PASSWORD_RESET' | 'MFA_RECOVERY';

type TokenDependencies = {
  prisma?: PrismaClient;
  now?: Date;
  tokenGenerator?: () => string;
};

export async function issueAuthToken(input: {
  userId: string;
  type: AuthTokenType;
  requestedIp: string | null;
  userAgent: string | null;
}, dependencies: TokenDependencies = {}): Promise<{ rawToken: string; expiresAt: Date }> {
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const rawToken = (dependencies.tokenGenerator ?? generateOpaqueToken)();
  const expiresAt = new Date(now.getTime() + readServerEnv().AUTH_TOKEN_TTL_MINUTES * 60_000);

  await prisma.authToken.create({
    data: {
      userId: input.userId,
      type: input.type,
      tokenHash: fingerprintToken(rawToken),
      expiresAt,
      requestedIp: input.requestedIp,
      userAgent: input.userAgent,
    },
  });

  return { rawToken, expiresAt };
}

export async function consumeSingleUseToken(
  rawToken: string,
  type: AuthTokenType,
  dependencies: TokenDependencies = {},
): Promise<{ userId: string } | null> {
  if (!rawToken || rawToken.length < 40) return null;

  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const tokenHash = fingerprintToken(rawToken);

  return prisma.$transaction(async (transaction) => {
    const token = await transaction.authToken.findUnique({ where: { tokenHash } });
    if (!token || token.type !== type || token.consumedAt || token.expiresAt <= now) return null;

    const consumed = await transaction.authToken.updateMany({
      where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    return consumed.count === 1 ? { userId: token.userId } : null;
  });
}
