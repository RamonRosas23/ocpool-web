import { z } from 'zod';
import { idempotencyKeySchema } from '@/server/http/idempotency';
import { MAX_MESSAGE_LENGTH } from '@/server/modules/messaging/domain';

export const messageBodySchema = z.object({
  body: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const messageQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export const conversationStatusSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']),
}).strict();
