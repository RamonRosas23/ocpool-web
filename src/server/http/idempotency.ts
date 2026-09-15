import { z } from 'zod';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
export const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export const idempotencyKeySchema = z.string()
  .min(MIN_IDEMPOTENCY_KEY_LENGTH)
  .max(MAX_IDEMPOTENCY_KEY_LENGTH)
  .regex(IDEMPOTENCY_KEY_PATTERN);
