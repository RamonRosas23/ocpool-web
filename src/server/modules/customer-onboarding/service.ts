import { generateOpaqueToken } from '@/server/auth/crypto';
import { issueCustomerMagicLinkInTransaction } from '@/server/auth/service';
import { requirePermission } from '@/server/auth/permissions';
import type { AuthRequestContext } from '@/server/auth/service';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { AppError } from '@/server/http/errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type CustomerOnboardingDependencies = {
  prisma?: PrismaClient;
  now?: Date;
  tokenGenerator?: () => string;
  context?: AuthRequestContext;
};

export type CustomerAccessResult = {
  quoteRequestId: string;
  folio: string;
  status: 'INVITED' | 'ALREADY_PENDING' | 'ALREADY_ACTIVE';
  email: string;
};

function requireQuoteRequestId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR', 'La solicitud no es válida.', 400);
  return value;
}

function conflict(): never {
  throw new AppError('CONFLICT', 'El contacto no puede habilitarse para el portal.', 409);
}

function authContext(value: AuthRequestContext | undefined): AuthRequestContext {
  return value ?? { ipAddress: null, userAgent: 'staff-customer-onboarding' };
}

async function lockQuoteRequest(transaction: Prisma.TransactionClient, quoteRequestId: string) {
  const rows = await transaction.$queryRaw<Array<{ id: string; folio: string; clientId: string; contactId: string }>>(Prisma.sql`
    SELECT "id", "folio", "clientId", "contactId"
    FROM "quote_requests"
    WHERE "id" = ${quoteRequestId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

function isKnownConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function inviteCustomerPortalAccess(
  actor: Actor,
  quoteRequestId: string,
  dependencies: CustomerOnboardingDependencies = {},
): Promise<CustomerAccessResult> {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'identity.users.manage');

  const requestId = requireQuoteRequestId(quoteRequestId);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new AppError('VALIDATION_ERROR', 'La fecha de operación no es válida.', 400);

  try {
    return await prisma.$transaction(async (transaction) => {
      const request = await lockQuoteRequest(transaction, requestId);
      if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);

      const contact = await transaction.clientContact.findUnique({
        where: { id: request.contactId },
        include: { client: true, user: { include: { contactProfile: { select: { id: true } } } } },
      });
      if (!contact || contact.clientId !== request.clientId || contact.status !== 'ACTIVE' || contact.client.status !== 'ACTIVE') {
        throw new AppError('CONFLICT', 'El contacto no puede habilitarse para el portal.', 409);
      }

      const customerRole = await transaction.role.findUnique({ where: { key: 'customer' }, select: { id: true } });
      if (!customerRole) throw new AppError('INTERNAL_ERROR', 'La configuración de acceso no está disponible.', 500);

      let user = contact.user;
      if (user && (user.type !== 'CUSTOMER' || user.clientId !== request.clientId || user.contactProfile && user.contactProfile.id !== contact.id || !['INVITED', 'ACTIVE'].includes(user.status))) {
        conflict();
      }

      if (!user) {
        const existing = await transaction.user.findUnique({
          where: { emailNormalized: contact.emailNormalized },
          include: { contactProfile: { select: { id: true } } },
        });
        if (existing && (existing.type !== 'CUSTOMER' || existing.clientId !== request.clientId || existing.contactProfile && existing.contactProfile.id !== contact.id || !['INVITED', 'ACTIVE'].includes(existing.status))) {
          conflict();
        }
        user = existing ?? await transaction.user.create({
          data: {
            email: contact.email,
            emailNormalized: contact.emailNormalized,
            displayName: contact.displayName,
            type: 'CUSTOMER',
            status: 'INVITED',
            clientId: request.clientId,
          },
          include: { contactProfile: { select: { id: true } } },
        });
        await transaction.clientContact.update({ where: { id: contact.id }, data: { userId: user.id } });
      }

      await transaction.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: customerRole.id } },
        create: { userId: user.id, roleId: customerRole.id },
        update: {},
      });

      const pending = await transaction.authToken.findFirst({
        where: { userId: user.id, type: 'MAGIC_LINK', consumedAt: null, expiresAt: { gt: now } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (pending) {
        return { quoteRequestId: request.id, folio: request.folio, status: 'ALREADY_PENDING', email: contact.email };
      }

      await transaction.authToken.updateMany({ where: { userId: user.id, type: 'MAGIC_LINK', consumedAt: null }, data: { consumedAt: now } });
      await issueCustomerMagicLinkInTransaction(transaction, {
        userId: user.id,
        identifier: contact.email,
        context: authContext(dependencies.context),
        now,
        rawToken: (dependencies.tokenGenerator ?? generateOpaqueToken)(),
      });

      const result: CustomerAccessResult = {
        quoteRequestId: request.id,
        folio: request.folio,
        status: user.status === 'ACTIVE' ? 'ALREADY_ACTIVE' : 'INVITED',
        email: contact.email,
      };
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: 'customer_access.invited',
          entityType: 'quote_request',
          entityId: request.id,
          outcome: 'SUCCESS',
          metadata: { folio: request.folio, outcome: result.status },
        },
      });
      return result;
    });
  } catch (error) {
    if (isKnownConflict(error)) conflict();
    throw error;
  }
}
