-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "outboxEventId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "recipientUserId" UUID,
    "recipientAddressCiphertext" VARCHAR(600),
    "recipientAddressHash" CHAR(64) NOT NULL,
    "templateKey" VARCHAR(120) NOT NULL,
    "templateVersion" VARCHAR(64) NOT NULL,
    "subjectSnapshot" VARCHAR(240),
    "payload" JSONB,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" TIMESTAMPTZ(3),
    "processedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(80),
    "providerMessageId" VARCHAR(240),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_deliveries_status_availableAt_idx" ON "notification_deliveries"("status", "availableAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_outboxEventId_idx" ON "notification_deliveries"("outboxEventId");

-- CreateIndex
CREATE INDEX "notification_deliveries_recipientUserId_createdAt_idx" ON "notification_deliveries"("recipientUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_outboxEventId_channel_recipientAddr_key" ON "notification_deliveries"("outboxEventId", "channel", "recipientAddressHash", "templateKey", "templateVersion");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
