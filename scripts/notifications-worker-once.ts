import 'dotenv/config';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { classifyNotificationError, processNotificationBatch } from '@/server/modules/notifications/worker';

const env = readServerEnv();
const prisma = getPrisma();

try {
  const result = await processNotificationBatch({
    prisma,
    batchSize: env.NOTIFICATION_BATCH_SIZE,
    leaseSeconds: env.NOTIFICATION_LEASE_SECONDS,
    maxAttempts: env.NOTIFICATION_MAX_ATTEMPTS,
  });
  console.log(JSON.stringify({ service: 'notifications', mode: 'once', ...result }));
} catch (error) {
  console.error(JSON.stringify({ service: 'notifications', mode: 'once', code: classifyNotificationError(error).code }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
