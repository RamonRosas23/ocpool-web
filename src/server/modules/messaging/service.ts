import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { requirePermission } from '@/server/auth/permissions';
import { checkAuthRateLimit } from '@/server/auth/rate-limit';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { requireStaffRequestReadScope } from '@/server/auth/request-scope';
import {
  assertConversationOpen,
  normalizeIdempotencyKey,
  normalizeMessageBody,
  type MessageVisibility,
} from '@/server/modules/messaging/domain';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type MessagingRateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number | null;
};

export type MessagingRateLimit = (input: { key: string; now: Date }) => Promise<MessagingRateLimitDecision>;

export type MessagingServiceDependencies = Readonly<{
  prisma?: PrismaClient;
  now?: Date;
  rateLimit?: MessagingRateLimit;
}>;

export type SendMessageInput = Readonly<{
  body: string;
  idempotencyKey: string;
}>;

export type ConversationMessageListFilters = Readonly<{
  cursor?: string;
  limit?: number;
}>;

type LockedRequest = {
  id: string;
  folio: string;
  clientId: string;
  currentAssigneeId: string | null;
};

export type StaffMessageTransactionRequest = LockedRequest;

type SerializedSender = {
  id?: string;
  displayName: string;
  type: 'CUSTOMER' | 'EMPLOYEE';
} | null;

type SerializedMessage = {
  id: string;
  conversationId: string;
  visibility: MessageVisibility;
  body: string;
  createdAt: Date;
  sender: SerializedSender;
};

function serializeConversation(conversation: {
  id: string;
  quoteRequestId: string;
  clientId: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}, exposeClientId: boolean) {
  return {
    id: conversation.id,
    quoteRequestId: conversation.quoteRequestId,
    ...(exposeClientId ? { clientId: conversation.clientId } : {}),
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    closedAt: conversation.closedAt,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_MESSAGE_LIMIT = 30;
const MAX_MESSAGE_LIMIT = 100;
const RATE_LIMIT_SCOPE = 'messaging-send';
const RATE_LIMIT_MAX_ATTEMPTS = 20;
const RATE_LIMIT_WINDOW_MINUTES = 10;

function requireUuid(value: string, message = 'La solicitud no es válida.', invalidCode: 'VALIDATION_ERROR' | 'NOT_FOUND' = 'VALIDATION_ERROR'): string {
  if (!UUID_PATTERN.test(value)) throw new AppError(invalidCode, invalidCode === 'NOT_FOUND' ? 'La conversación no existe.' : message, invalidCode === 'NOT_FOUND' ? 404 : 400);
  return value;
}

function requireStaffPermission(actor: Actor, permission: string): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, permission);
}

function requireCustomerPermission(actor: Actor, permission: string): string {
  if (actor.type !== 'CUSTOMER' || !actor.clientId) {
    throw new AppError('NOT_FOUND', 'La conversación no existe.', 404);
  }
  requirePermission(actor, permission);
  return actor.clientId;
}

function normalizeInput(input: SendMessageInput): { body: string; idempotencyKey: string; idempotencyKeyHash: string } {
  if (!input || typeof input.body !== 'string' || typeof input.idempotencyKey !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'El mensaje no es válido.', 400);
  }
  try {
    const body = normalizeMessageBody(input.body);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    return { body, idempotencyKey, idempotencyKeyHash: fingerprintToken(idempotencyKey) };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El mensaje no es válido.', 400);
  }
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MESSAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MESSAGE_LIMIT) {
    throw new AppError('VALIDATION_ERROR', 'El límite de mensajes no es válido.', 400);
  }
  return limit;
}

function encodeCursor(message: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: message.createdAt.toISOString(), id: message.id }), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    if (typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string' || !UUID_PATTERN.test(decoded.id)) throw new Error('Invalid cursor.');
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error('Invalid cursor.');
    return { createdAt, id: decoded.id };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El cursor no es válido.', 400);
  }
}

async function lockQuoteRequest(
  transaction: Prisma.TransactionClient,
  quoteRequestId: string,
  clientId?: string,
): Promise<LockedRequest | null> {
  const rows = await transaction.$queryRaw<LockedRequest[]>(Prisma.sql`
    SELECT "id", "folio", "clientId", "currentAssigneeId"
    FROM "quote_requests"
    WHERE "id" = ${quoteRequestId}
      ${clientId ? Prisma.sql`AND "clientId" = ${clientId}` : Prisma.empty}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function getOrCreateConversation(
  transaction: Prisma.TransactionClient,
  request: LockedRequest,
  now: Date,
) {
  const existing = await transaction.conversation.findUnique({ where: { quoteRequestId: request.id } });
  if (existing) return existing;
  try {
    return await transaction.conversation.create({
      data: { quoteRequestId: request.id, clientId: request.clientId, createdAt: now, updatedAt: now },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const concurrent = await transaction.conversation.findUnique({ where: { quoteRequestId: request.id } });
    if (!concurrent) throw error;
    return concurrent;
  }
}

function assertConversationCanReceiveMessages(status: 'OPEN' | 'CLOSED'): void {
  try {
    assertConversationOpen(status);
  } catch {
    throw new AppError('CONFLICT', 'La conversación está cerrada.', 409);
  }
}

async function enforceSendRateLimit(actor: Actor, quoteRequestId: string, now: Date, dependency?: MessagingRateLimit): Promise<void> {
  const rateLimit = dependency ?? (async (input: { key: string; now: Date }) => checkAuthRateLimit({
    scope: RATE_LIMIT_SCOPE,
    key: input.key,
    maxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
    windowMinutes: RATE_LIMIT_WINDOW_MINUTES,
    now: input.now,
  }));
  const decision = await rateLimit({ key: `${actor.userId}:${quoteRequestId}`, now });
  if (!decision.allowed) throw new AppError('RATE_LIMITED', 'Has alcanzado el límite temporal de mensajes.', 429);
}

async function writeMessage(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  request: LockedRequest,
  visibility: MessageVisibility,
  input: SendMessageInput,
  now: Date,
) {
  const normalized = normalizeInput(input);
  const conversation = await getOrCreateConversation(transaction, request, now);
  assertConversationCanReceiveMessages(conversation.status);

  const existing = await transaction.conversationMessage.findUnique({
    where: {
      conversationId_senderUserId_idempotencyKeyHash: {
        conversationId: conversation.id,
        senderUserId: actor.userId,
        idempotencyKeyHash: normalized.idempotencyKeyHash,
      },
    },
    include: { sender: { select: { id: true, displayName: true, type: true } } },
  });
  if (existing) return { ...serializeMessage(existing, actor.type === 'EMPLOYEE'), conversation: serializeConversation(conversation, actor.type === 'EMPLOYEE'), idempotent: true };

  const message = await transaction.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      senderUserId: actor.userId,
      visibility,
      body: normalized.body,
      idempotencyKeyHash: normalized.idempotencyKeyHash,
      createdAt: now,
    },
    include: { sender: { select: { id: true, displayName: true, type: true } } },
  });
  await transaction.conversation.update({ where: { id: conversation.id }, data: { updatedAt: now } });
  await transaction.auditLog.create({
    data: {
      actorUserId: actor.userId,
      action: 'conversation.message_created',
      entityType: 'conversation_message',
      entityId: message.id,
      outcome: 'SUCCESS',
      metadata: { conversationId: conversation.id, quoteRequestId: request.id, folio: request.folio, visibility },
    },
  });
  await transaction.outboxEvent.create({
    data: {
      eventType: 'MESSAGE.CREATED',
      aggregateType: 'CONVERSATION',
      aggregateId: conversation.id,
      payload: {
        conversationId: conversation.id,
        quoteRequestId: request.id,
        clientId: request.clientId,
        messageId: message.id,
        visibility,
        folio: request.folio,
      },
    },
  });
  return { ...serializeMessage(message, actor.type === 'EMPLOYEE'), conversation: serializeConversation(conversation, actor.type === 'EMPLOYEE'), idempotent: false };
}

function serializeMessage(message: {
  id: string;
  conversationId: string;
  visibility: MessageVisibility;
  body: string;
  createdAt: Date;
  sender: { id: string; displayName: string; type: 'CUSTOMER' | 'EMPLOYEE' } | null;
}, exposeSenderId: boolean): SerializedMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    visibility: message.visibility,
    body: message.body,
    createdAt: message.createdAt,
    sender: message.sender
      ? { ...(exposeSenderId ? { id: message.sender.id } : {}), displayName: message.sender.displayName, type: message.sender.type }
      : null,
  };
}

function genericNotFound(): never {
  throw new AppError('NOT_FOUND', 'La conversación no existe.', 404);
}

async function sendMessage(
  actor: Actor,
  quoteRequestId: string,
  input: SendMessageInput,
  visibility: MessageVisibility,
  dependencies: MessagingServiceDependencies,
  scopeClientId?: string,
  invalidIdCode: 'VALIDATION_ERROR' | 'NOT_FOUND' = 'VALIDATION_ERROR',
) {
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, undefined, invalidIdCode);
  const now = dependencies.now ?? new Date();
  await enforceSendRateLimit(actor, requestId, now, dependencies.rateLimit);
  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId, scopeClientId);
    if (!request) genericNotFound();
    if (actor.type === 'EMPLOYEE') requireStaffRequestReadScope(actor, request.currentAssigneeId);
    const result = await writeMessage(transaction, actor, request, visibility, input, now);
    const publicResult = { ...result };
    Reflect.deleteProperty(publicResult, 'idempotent');
    return publicResult;
  });
}

export async function sendCustomerMessage(
  actor: Actor,
  quoteRequestId: string,
  input: SendMessageInput,
  dependencies: MessagingServiceDependencies = {},
) {
  const clientId = requireCustomerPermission(actor, 'messaging.send');
  return sendMessage(actor, quoteRequestId, input, 'CUSTOMER', dependencies, clientId, 'NOT_FOUND');
}

export async function sendStaffMessage(
  actor: Actor,
  quoteRequestId: string,
  input: SendMessageInput,
  dependencies: MessagingServiceDependencies = {},
) {
  requireStaffPermission(actor, 'requests.read');
  requirePermission(actor, 'messaging.send');
  return sendMessage(actor, quoteRequestId, input, 'CUSTOMER', dependencies);
}

export async function sendStaffMessageInTransaction(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  request: StaffMessageTransactionRequest,
  input: SendMessageInput,
  now: Date,
) {
  requireStaffPermission(actor, 'requests.read');
  requirePermission(actor, 'messaging.send');
  requireStaffRequestReadScope(actor, request.currentAssigneeId);
  return writeMessage(transaction, actor, request, 'CUSTOMER', input, now);
}

export async function createInternalNote(
  actor: Actor,
  quoteRequestId: string,
  input: SendMessageInput,
  dependencies: MessagingServiceDependencies = {},
) {
  requireStaffPermission(actor, 'requests.read');
  requirePermission(actor, 'messaging.internal_notes.write');
  return sendMessage(actor, quoteRequestId, input, 'INTERNAL', dependencies);
}

export async function listConversationMessages(
  actor: Actor,
  quoteRequestId: string,
  filters: ConversationMessageListFilters = {},
  dependencies: MessagingServiceDependencies = {},
) {
  const prisma = dependencies.prisma ?? getPrisma();
  const scopeClientId = actor.type === 'CUSTOMER' ? requireCustomerPermission(actor, 'messaging.read') : undefined;
  if (actor.type === 'EMPLOYEE') {
    requireStaffPermission(actor, 'requests.read');
    requirePermission(actor, 'messaging.read');
  }
  const requestId = requireUuid(quoteRequestId, undefined, actor.type === 'CUSTOMER' ? 'NOT_FOUND' : 'VALIDATION_ERROR');
  const limit = normalizeLimit(filters.limit);
  const cursor = decodeCursor(filters.cursor);
  const request = await lockQuoteRequestForRead(prisma, requestId, scopeClientId);
  if (!request) genericNotFound();
  if (actor.type === 'EMPLOYEE') requireStaffRequestReadScope(actor, request.currentAssigneeId);

  const conversation = await prisma.conversation.findUnique({ where: { quoteRequestId: request.id } });
  if (!conversation) return { conversation: null, items: [] as SerializedMessage[], nextCursor: null };

  const canReadInternal = actor.type === 'EMPLOYEE' && actor.permissionKeys.has('messaging.internal_notes.read');
  const messages = await prisma.conversationMessage.findMany({
    where: {
      conversationId: conversation.id,
      visibility: canReadInternal ? undefined : 'CUSTOMER',
      ...(cursor ? {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    include: { sender: { select: { id: true, displayName: true, type: true } } },
  });
  const hasNext = messages.length > limit;
  const items = (hasNext ? messages.slice(0, limit) : messages).map((message) => serializeMessage(message, actor.type === 'EMPLOYEE'));
  return {
    conversation: serializeConversation(conversation, actor.type === 'EMPLOYEE'),
    items,
    nextCursor: hasNext ? encodeCursor(messages[limit - 1]) : null,
  };
}

async function lockQuoteRequestForRead(prisma: DbClient, quoteRequestId: string, clientId?: string): Promise<LockedRequest | null> {
  const rows = await prisma.$queryRaw<LockedRequest[]>(Prisma.sql`
    SELECT "id", "folio", "clientId", "currentAssigneeId"
    FROM "quote_requests"
    WHERE "id" = ${quoteRequestId}
      ${clientId ? Prisma.sql`AND "clientId" = ${clientId}` : Prisma.empty}
  `);
  return rows[0] ?? null;
}

export async function closeConversation(
  actor: Actor,
  quoteRequestId: string,
  dependencies: MessagingServiceDependencies = {},
) {
  requireStaffPermission(actor, 'requests.read');
  requirePermission(actor, 'messaging.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId);
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId);
    if (!request) genericNotFound();
    requireStaffRequestReadScope(actor, request.currentAssigneeId);
    const conversation = await transaction.conversation.findUnique({ where: { quoteRequestId: request.id } });
    if (!conversation) genericNotFound();
    if (conversation.status === 'CLOSED') {
      return { conversationId: conversation.id, quoteRequestId: request.id, status: conversation.status, closedAt: conversation.closedAt };
    }
    const closed = await transaction.conversation.update({
      where: { id: conversation.id },
      data: { status: 'CLOSED', closedAt: now, closedById: actor.userId, updatedAt: now },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'conversation.status_changed',
        entityType: 'conversation',
        entityId: conversation.id,
        outcome: 'SUCCESS',
        metadata: { quoteRequestId: request.id, folio: request.folio, fromStatus: conversation.status, toStatus: closed.status },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'CONVERSATION.STATUS_CHANGED',
        aggregateType: 'CONVERSATION',
        aggregateId: conversation.id,
        payload: { conversationId: conversation.id, quoteRequestId: request.id, folio: request.folio, fromStatus: conversation.status, toStatus: closed.status },
      },
    });
    return { conversationId: closed.id, quoteRequestId: request.id, status: closed.status, closedAt: closed.closedAt };
  });
}

export async function reopenConversation(
  actor: Actor,
  quoteRequestId: string,
  dependencies: MessagingServiceDependencies = {},
) {
  requireStaffPermission(actor, 'requests.read');
  requirePermission(actor, 'messaging.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId);
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId);
    if (!request) genericNotFound();
    requireStaffRequestReadScope(actor, request.currentAssigneeId);
    const conversation = await transaction.conversation.findUnique({ where: { quoteRequestId: request.id } });
    if (!conversation) genericNotFound();
    if (conversation.status === 'OPEN') {
      return { conversationId: conversation.id, quoteRequestId: request.id, status: conversation.status, closedAt: conversation.closedAt };
    }
    const reopened = await transaction.conversation.update({
      where: { id: conversation.id },
      data: { status: 'OPEN', closedAt: null, closedById: null, updatedAt: now },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'conversation.status_changed',
        entityType: 'conversation',
        entityId: conversation.id,
        outcome: 'SUCCESS',
        metadata: { quoteRequestId: request.id, folio: request.folio, fromStatus: conversation.status, toStatus: reopened.status },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'CONVERSATION.STATUS_CHANGED',
        aggregateType: 'CONVERSATION',
        aggregateId: conversation.id,
        payload: { conversationId: conversation.id, quoteRequestId: request.id, folio: request.folio, fromStatus: conversation.status, toStatus: reopened.status },
      },
    });
    return { conversationId: reopened.id, quoteRequestId: request.id, status: reopened.status, closedAt: reopened.closedAt };
  });
}
