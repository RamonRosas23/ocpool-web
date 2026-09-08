import { describe, expect, it } from 'vitest';
import { fingerprintToken, encryptSecret } from '@/server/auth/crypto';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { processNotificationFanoutBatch } from '@/server/modules/notifications/fanout';
import { processNotificationBatch } from '@/server/modules/notifications/worker';

type MailpitMessage = { ID: string; Subject: string; To: Array<{ Address: string }>; From: { Address: string } };

async function listMailpitMessages(): Promise<MailpitMessage[]> {
  const response = await fetch('http://127.0.0.1:18025/api/v1/messages?limit=100');
  if (!response.ok) throw new Error(`Mailpit list failed: ${response.status}`);
  const body = await response.json() as { messages?: MailpitMessage[] };
  return body.messages ?? [];
}

async function deleteMailpitMessage(id: string): Promise<void> {
  const response = await fetch('http://127.0.0.1:18025/api/v1/messages', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
  if (!response.ok) throw new Error(`Mailpit delete failed: ${response.status}`);
}

describe('notification worker Mailpit contract', () => {
  it('materializes an auth event and receives the real SMTP message in Mailpit', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const recipientEmail = `fanout-mailpit-${suffix}@example.test`;
    const rawToken = `mailpit-auth-token-${suffix}-never-persisted`;
    const now = new Date('2000-01-01T12:00:00.000Z');
    const client = await prisma.client.create({ data: { displayName: `Mailpit client ${suffix}` } });
    const user = await prisma.user.create({ data: { email: recipientEmail, emailNormalized: recipientEmail, displayName: 'Mailpit recipient', type: 'CUSTOMER', status: 'ACTIVE', clientId: client.id } });
    const token = await prisma.authToken.create({ data: { userId: user.id, type: 'MAGIC_LINK', tokenHash: fingerprintToken(rawToken), expiresAt: new Date('2030-01-01T00:00:00.000Z') } });
    const event = await prisma.outboxEvent.create({ data: { eventType: 'AUTH.CUSTOMER_MAGIC_LINK', aggregateType: 'USER', aggregateId: user.id, availableAt: now, payload: { tokenId: token.id, tokenCiphertext: encryptSecret(rawToken, readServerEnv().AUTH_DELIVERY_ENCRYPTION_KEY), tokenType: 'MAGIC_LINK' } } });
    let mailpitId: string | null = null;

    try {
      await expect(processNotificationFanoutBatch({ prisma, now, batchSize: 10, leaseSeconds: 60 })).resolves.toMatchObject({ claimed: 1, materialized: 1 });
      const delivery = await prisma.notificationDelivery.findFirstOrThrow({ where: { outboxEventId: event.id } });
      await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { availableAt: now } });
      const result = await processNotificationBatch({ prisma, now: new Date(now.getTime() + 1_000), batchSize: 10, leaseSeconds: 60, maxAttempts: 3 });
      expect(result).toMatchObject({ fanoutClaimed: 0, claimed: 1, sent: 1 });
      const message = (await listMailpitMessages()).find((candidate) => candidate.To.some((to) => to.Address === recipientEmail));
      expect(message).toBeDefined();
      expect(message).toMatchObject({ Subject: 'Tu acceso seguro a OCPOOL', From: { Address: readServerEnv().SMTP_FROM_EMAIL } });
      mailpitId = message?.ID ?? null;
    } finally {
      if (mailpitId) await deleteMailpitMessage(mailpitId);
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: event.id } });
      await prisma.outboxEvent.delete({ where: { id: event.id } });
      await prisma.authToken.delete({ where: { id: token.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.client.delete({ where: { id: client.id } });
    }
  }, 30_000);
});
