import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import type { QuoteRequestBudgetRange, QuoteRequestProjectStage, QuoteRequestTimeline } from '@/generated/prisma/enums';
import { fingerprintToken } from '@/server/auth/crypto';
import { getPrisma } from '@/server/db/client';
import { BUSINESS_TIMEZONE, timeZoneParts } from '@/lib/calendar-timezone';
import { AppError } from '@/server/http/errors';
import {
  formatQuoteRequestFolio,
  normalizeQuoteRequestEmail,
  normalizeQuoteRequestText,
} from '@/server/modules/quote-requests/domain';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CreateQuoteRequestInput = {
  idempotencyKey: string;
  origin: 'PUBLIC_FORM' | 'STAFF_CREATED';
  actorUserId?: string | null;
  contact: {
    displayName: string;
    email: string;
    phone?: string | null;
    roleTitle?: string | null;
  };
  detail: {
    projectType: string;
    location: string;
    projectStage?: QuoteRequestProjectStage | null;
    timeline?: QuoteRequestTimeline | null;
    budgetRange?: QuoteRequestBudgetRange | null;
    budgetCents?: number | bigint | null;
    currencyCode?: string;
    dimensions?: string | null;
    description: string;
    consentAt: Date;
  };
  contactResolution?: { type: 'automatic' } | { type: 'existing'; contactId: string } | { type: 'new' };
};

export type QuoteRequestResult = {
  quoteRequestId: string;
  folio: string;
  clientId: string;
  contactId: string;
};

export type QuoteRequestServiceDependencies = {
  prisma?: PrismaClient;
  now?: Date;
};

const FOLIO_SEQUENCE_KEY = 'quote_request';

function normalizedOptionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return normalizeQuoteRequestText(value, maxLength);
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 16 || normalized.length > 200) throw new Error('Invalid quote request idempotency key.');
  return normalized;
}

function normalizeCurrencyCode(value: string | undefined): string {
  const normalized = (value ?? 'MXN').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error('Invalid quote request currency.');
  return normalized;
}

function normalizeBudgetCents(value: number | bigint | null | undefined): bigint | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid quote request budget.');
    return BigInt(value);
  }
  if (value < 0n) throw new Error('Invalid quote request budget.');
  return value;
}

async function allocateFolio(transaction: Prisma.TransactionClient, now: Date): Promise<string> {
  await transaction.folioSequence.upsert({
    where: { key: FOLIO_SEQUENCE_KEY },
    update: {},
    create: { key: FOLIO_SEQUENCE_KEY, nextValue: 1 },
  });

  const rows = await transaction.$queryRaw<Array<{ nextValue: number }>>(Prisma.sql`
    SELECT "nextValue"
    FROM "folio_sequences"
    WHERE "key" = ${FOLIO_SEQUENCE_KEY}
    FOR UPDATE
  `);
  const sequence = rows[0]?.nextValue;
  if (!sequence) throw new Error('Quote request folio sequence is unavailable.');

  await transaction.folioSequence.update({
    where: { key: FOLIO_SEQUENCE_KEY },
    data: { nextValue: { increment: 1 } },
  });
  // El prefijo de año del folio debe reflejar el año calendario de negocio (America/Chihuahua), no
  // el año UTC -- en las últimas horas de cada 31 de diciembre en hora local, `getUTCFullYear()` ya
  // había rodado al año siguiente y el folio mostraba un año que todavía no era el actual localmente.
  return formatQuoteRequestFolio(timeZoneParts(now, BUSINESS_TIMEZONE).year, sequence);
}

async function resolveClientAndContact(transaction: Prisma.TransactionClient, input: CreateQuoteRequestInput['contact'], resolution: CreateQuoteRequestInput['contactResolution'] = { type: 'automatic' }) {
  const emailNormalized = normalizeQuoteRequestEmail(input.email);
  const displayName = normalizeQuoteRequestText(input.displayName, 180);
  const phone = normalizedOptionalText(input.phone, 40);
  const roleTitle = normalizedOptionalText(input.roleTitle, 120);
  if (resolution.type === 'existing') {
    const existing = await transaction.clientContact.findUnique({ where: { id: resolution.contactId }, select: { id: true, clientId: true, emailNormalized: true, status: true, client: { select: { status: true } } } });
    if (!existing || existing.status !== 'ACTIVE' || existing.client.status !== 'ACTIVE' || existing.emailNormalized !== emailNormalized) throw new Error('Selected quote request contact is no longer available.');
    return { clientId: existing.clientId, contactId: existing.id };
  }
  const matches = await transaction.clientContact.findMany({
    where: { emailNormalized, status: 'ACTIVE', client: { status: 'ACTIVE' } },
    orderBy: { createdAt: 'asc' },
    include: { client: true },
  });

  if (resolution.type !== 'new' && matches.length === 1) {
    return { clientId: matches[0].clientId, contactId: matches[0].id };
  }

  const client = await transaction.client.create({ data: { displayName } });
  const contact = await transaction.clientContact.create({
    data: {
      clientId: client.id,
      displayName,
      email: input.email.trim(),
      emailNormalized,
      phone,
      roleTitle,
      isPrimary: true,
    },
  });
  return { clientId: client.id, contactId: contact.id };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

type NormalizedQuoteRequestDetail = {
  origin: 'PUBLIC_FORM' | 'STAFF_CREATED';
  projectType: string;
  location: string;
  dimensions: string | null;
  description: string;
  currencyCode: string;
  budgetCents: bigint | undefined;
  projectStage: QuoteRequestProjectStage | null | undefined;
  timeline: QuoteRequestTimeline | null | undefined;
  budgetRange: QuoteRequestBudgetRange | null | undefined;
};

async function findByIdempotencyKey(prisma: DbClient, idempotencyKeyHash: string): Promise<(QuoteRequestResult & NormalizedQuoteRequestDetail) | null> {
  const existing = await prisma.quoteRequest.findUnique({
    where: { idempotencyKeyHash },
    include: { detail: true },
  });
  if (!existing || !existing.detail) return null;
  return {
    quoteRequestId: existing.id,
    folio: existing.folio,
    clientId: existing.clientId,
    contactId: existing.contactId,
    origin: existing.origin,
    projectType: existing.detail.projectType,
    location: existing.detail.location,
    dimensions: existing.detail.dimensions,
    description: existing.detail.description,
    currencyCode: existing.detail.currencyCode,
    budgetCents: existing.detail.budgetCents ?? undefined,
    projectStage: existing.detail.projectStage ?? undefined,
    timeline: existing.detail.timeline ?? undefined,
    budgetRange: existing.detail.budgetRange ?? undefined,
  };
}

// H1-02: reutilizar la llave de idempotencia con datos distintos nunca debe regresar en silencio
// la primera solicitud creada -- mismo criterio que sameReservation() en private-files/service.ts.
function sameQuoteRequest(existing: NormalizedQuoteRequestDetail, candidate: NormalizedQuoteRequestDetail): boolean {
  return existing.origin === candidate.origin
    && existing.projectType === candidate.projectType
    && existing.location === candidate.location
    && existing.dimensions === candidate.dimensions
    && existing.description === candidate.description
    && existing.currencyCode === candidate.currencyCode
    && existing.budgetCents === candidate.budgetCents
    && existing.projectStage === candidate.projectStage
    && existing.timeline === candidate.timeline
    && existing.budgetRange === candidate.budgetRange;
}

function toQuoteRequestResult(existing: QuoteRequestResult & NormalizedQuoteRequestDetail): QuoteRequestResult {
  return { quoteRequestId: existing.quoteRequestId, folio: existing.folio, clientId: existing.clientId, contactId: existing.contactId };
}

export async function createQuoteRequest(input: CreateQuoteRequestInput, dependencies: QuoteRequestServiceDependencies = {}): Promise<QuoteRequestResult> {
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const idempotencyKeyHash = fingerprintToken(normalizeIdempotencyKey(input.idempotencyKey));
  const projectType = normalizeQuoteRequestText(input.detail.projectType, 120);
  const location = normalizeQuoteRequestText(input.detail.location, 180);
  const dimensions = normalizedOptionalText(input.detail.dimensions, 500);
  const description = normalizeQuoteRequestText(input.detail.description, 10_000);
  const currencyCode = normalizeCurrencyCode(input.detail.currencyCode);
  const budgetCents = normalizeBudgetCents(input.detail.budgetCents);
  const candidate: NormalizedQuoteRequestDetail = {
    origin: input.origin,
    projectType,
    location,
    dimensions,
    description,
    currencyCode,
    budgetCents,
    projectStage: input.detail.projectStage,
    timeline: input.detail.timeline,
    budgetRange: input.detail.budgetRange,
  };
  const assertReplayMatches = (existing: NormalizedQuoteRequestDetail) => {
    if (!sameQuoteRequest(existing, candidate)) {
      // UX audit fix: este mensaje puede llegar hasta el formulario público (visitantes anónimos),
      // no sólo a staff — nunca debe mencionar términos internos como "llave de idempotencia".
      throw new AppError('CONFLICT', 'Ya se registró un envío distinto para este intento. Recarga la página e inténtalo de nuevo.', 409);
    }
  };

  try {
    return await prisma.$transaction(async (transaction) => {
      const existing = await findByIdempotencyKey(transaction, idempotencyKeyHash);
      if (existing) { assertReplayMatches(existing); return toQuoteRequestResult(existing); }

      const { clientId, contactId } = await resolveClientAndContact(transaction, input.contact, input.contactResolution);
      const folio = await allocateFolio(transaction, now);
      const request = await transaction.quoteRequest.create({
        data: {
          folio,
          idempotencyKeyHash,
          clientId,
          contactId,
          origin: input.origin,
          detail: {
            create: {
              projectType,
              location,
              projectStage: input.detail.projectStage,
              timeline: input.detail.timeline,
              budgetRange: input.detail.budgetRange,
              budgetCents,
              currencyCode,
              dimensions,
              description,
              consentAt: input.detail.consentAt,
            },
          },
          statusHistory: {
            create: {
              toStatus: 'RECIBIDA',
              changedById: input.actorUserId ?? undefined,
            },
          },
        },
      });

      await transaction.auditLog.create({
        data: {
          actorUserId: input.actorUserId ?? null,
          action: 'quote_request.created',
          entityType: 'quote_request',
          entityId: request.id,
          outcome: 'SUCCESS',
          metadata: { folio, origin: input.origin },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: 'REQUEST.RECEIVED',
          aggregateType: 'QUOTE_REQUEST',
          aggregateId: request.id,
          payload: { quoteRequestId: request.id, folio, origin: input.origin },
        },
      });

      return { quoteRequestId: request.id, folio, clientId, contactId };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await findByIdempotencyKey(prisma, idempotencyKeyHash);
      if (existing) { assertReplayMatches(existing); return toQuoteRequestResult(existing); }
    }
    throw error;
  }
}
