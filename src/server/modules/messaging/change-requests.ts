import type { PrismaClient } from '@/generated/prisma/client';
import { changeRequestPrefix, parseChangeRequestBody } from '@/lib/change-request';

export type ChangeRequestSummary = { at: Date; message: string };

/**
 * Última petición de cambios que el cliente hizo desde el portal para esa versión (mensaje propio,
 * visible para ambos, con el prefijo de `changeRequestBody`). El texto se acota para las vistas.
 */
export async function findLatestChangeRequest(prisma: PrismaClient, quoteRequestId: string, versionNumber: number): Promise<ChangeRequestSummary | null> {
  const row = await prisma.conversationMessage.findFirst({
    where: {
      conversation: { quoteRequestId },
      visibility: 'CUSTOMER',
      sender: { is: { type: 'CUSTOMER' } },
      body: { startsWith: changeRequestPrefix(versionNumber) },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true, body: true },
  });
  if (!row) return null;
  const message = parseChangeRequestBody(row.body, versionNumber);
  return message === null ? null : { at: row.createdAt, message: message.slice(0, 500) };
}
