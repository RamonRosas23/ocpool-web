import type { InboxActivityEmail, PrismaClient } from '@/generated/prisma/client';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';

export type InboxPreferencesDto = Readonly<{
  sound: boolean;
  desktop: boolean;
  activityEmail: InboxActivityEmail;
  saved: boolean;
}>;

export type InboxPreferencePatch = Readonly<{
  sound?: boolean;
  desktop?: boolean;
  activityEmail?: InboxActivityEmail;
}>;

type Dependencies = Readonly<{ prisma?: PrismaClient }>;

export async function readInboxPreferences(actor: Actor, dependencies: Dependencies = {}): Promise<InboxPreferencesDto> {
  const prisma = dependencies.prisma ?? getPrisma();
  const row = await prisma.inboxPreference.findUnique({
    where: { userId: actor.userId },
    select: { soundEnabled: true, desktopEnabled: true, activityEmail: true },
  });
  return {
    sound: row?.soundEnabled ?? actor.type === 'EMPLOYEE',
    desktop: row?.desktopEnabled ?? false,
    activityEmail: row?.activityEmail ?? 'DIGEST',
    saved: row !== null,
  };
}

export async function updateInboxPreferences(actor: Actor, patch: InboxPreferencePatch, dependencies: Dependencies = {}): Promise<InboxPreferencesDto> {
  if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR', 'Elige al menos una preferencia para guardar.', 400);
  const prisma = dependencies.prisma ?? getPrisma();
  const update = {
    ...(patch.sound !== undefined ? { soundEnabled: patch.sound } : {}),
    ...(patch.desktop !== undefined ? { desktopEnabled: patch.desktop } : {}),
    ...(patch.activityEmail !== undefined ? { activityEmail: patch.activityEmail } : {}),
  };
  await prisma.inboxPreference.upsert({
    where: { userId: actor.userId },
    create: {
      userId: actor.userId,
      soundEnabled: patch.sound ?? null,
      desktopEnabled: patch.desktop ?? false,
      activityEmail: patch.activityEmail ?? 'DIGEST',
    },
    update,
  });
  return readInboxPreferences(actor, { prisma });
}
