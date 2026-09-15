import { z } from 'zod';
import { idempotencyKeySchema } from '@/server/http/idempotency';
import { FILE_CATEGORIES, FILE_MAX_BYTES, FILE_MAX_NAME_LENGTH, FILE_VISIBILITIES } from '@/server/modules/private-files/domain';

export const fileReserveSchema = z.object({
  originalFileName: z.string().trim().min(1).max(FILE_MAX_NAME_LENGTH),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().min(1).max(FILE_MAX_BYTES),
  category: z.enum(FILE_CATEGORIES),
  visibility: z.enum(FILE_VISIBILITIES),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const fileListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
}).strict();

export const fileCompleteSchema = z.object({}).strict();
