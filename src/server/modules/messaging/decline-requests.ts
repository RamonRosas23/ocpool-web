import type { PrismaClient } from '@/generated/prisma/client';
import { parseDeclineRequest, type DeclineReasonCode } from '@/lib/decline-request';

export type DeclineRequestSummary = Readonly<{ at: Date; reason: DeclineReasonCode; message: string }>;

/** Busca la última declinación escrita por el cliente para la versión indicada. */
export async function findLatestDeclineRequest(prisma: PrismaClient, quoteRequestId: string, versionNumber: number): Promise<DeclineRequestSummary | null> {
  const row = await prisma.conversationMessage.findFirst({
    where: {
      conversation: { quoteRequestId },
      visibility: 'CUSTOMER',
      sender: { is: { type: 'CUSTOMER' } },
      body: { startsWith: `Propuesta V${versionNumber} declinada:` },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { body: true, createdAt: true },
  });
  if (!row) return null;
  const parsed = parseDeclineRequest(row.body);
  if (!parsed || parsed.versionNumber !== versionNumber) return null;
  return { at: row.createdAt, reason: parsed.reason, message: row.body };
}
