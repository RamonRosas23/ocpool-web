-- Bandeja de avisos por persona (spec 2026-09-29-notificaciones-tiempo-real-design §1).
CREATE TYPE "InboxPriority" AS ENUM ('URGENT', 'HIGH', 'NORMAL', 'INFO');

CREATE TABLE "inbox_notifications" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "priority" "InboxPriority" NOT NULL,
    "groupKey" VARCHAR(200),
    "quoteRequestId" UUID,
    "actorId" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(400),
    "actionPath" VARCHAR(300) NOT NULL,
    "data" JSONB,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedNote" VARCHAR(160),
    CONSTRAINT "inbox_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inbox_notifications_recipientId_lastActivityAt_idx" ON "inbox_notifications"("recipientId", "lastActivityAt" DESC);
CREATE INDEX "inbox_notifications_recipientId_updatedAt_idx" ON "inbox_notifications"("recipientId", "updatedAt");
CREATE INDEX "inbox_notifications_quoteRequestId_idx" ON "inbox_notifications"("quoteRequestId");
CREATE INDEX "inbox_notifications_groupKey_idx" ON "inbox_notifications"("groupKey");
-- Contador de la campana: sólo lo abierto.
CREATE INDEX "inbox_notifications_open_recipient_idx" ON "inbox_notifications"("recipientId") WHERE "readAt" IS NULL AND "resolvedAt" IS NULL;
-- Agrupación: un solo aviso abierto por persona y grupo. Dos transacciones concurrentes quedan
-- serializadas por este índice (INSERT … ON CONFLICT DO NOTHING en src/server/modules/inbox/record.ts).
CREATE UNIQUE INDEX "inbox_notifications_open_group" ON "inbox_notifications"("recipientId", "groupKey") WHERE "groupKey" IS NOT NULL AND "readAt" IS NULL AND "resolvedAt" IS NULL;

ALTER TABLE "inbox_notifications"
  ADD CONSTRAINT "inbox_notifications_kind_ck" CHECK ("kind" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  ADD CONSTRAINT "inbox_notifications_action_path_ck" CHECK ("actionPath" ~ '^/[^/]'),
  ADD CONSTRAINT "inbox_notifications_occurrences_ck" CHECK ("occurrences" >= 1),
  ADD CONSTRAINT "inbox_notifications_resolution_ck" CHECK ("resolvedNote" IS NULL OR "resolvedAt" IS NOT NULL);

ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
