import 'dotenv/config';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { classifyNotificationError, runNotificationWorker } from '@/server/modules/notifications/worker';

const env = readServerEnv();
const prisma = getPrisma();
const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  await runNotificationWorker({
    prisma,
    batchSize: env.NOTIFICATION_BATCH_SIZE,
    leaseSeconds: env.NOTIFICATION_LEASE_SECONDS,
    maxAttempts: env.NOTIFICATION_MAX_ATTEMPTS,
    pollIntervalMs: env.NOTIFICATION_POLL_INTERVAL_MS,
    signal: controller.signal,
    onBatch: (result) => {
      if (result.claimed > 0) console.log(JSON.stringify({ service: 'notifications', mode: 'continuous', ...result }));
    },
  });
} catch (error) {
  console.error(JSON.stringify({ service: 'notifications', mode: 'continuous', code: classifyNotificationError(error).code }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
