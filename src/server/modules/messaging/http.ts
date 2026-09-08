import { z } from 'zod';
import { MAX_IDEMPOTENCY_KEY_LENGTH, MAX_MESSAGE_LENGTH, MIN_IDEMPOTENCY_KEY_LENGTH } from '@/server/modules/messaging/domain';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export const messageBodySchema = z.object({
  body: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  idempotencyKey: z.string()
    .min(MIN_IDEMPOTENCY_KEY_LENGTH)
    .max(MAX_IDEMPOTENCY_KEY_LENGTH)
    .regex(IDEMPOTENCY_KEY_PATTERN),
}).strict();

export const messageQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export const conversationStatusSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']),
}).strict();
