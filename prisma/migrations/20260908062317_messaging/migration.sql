-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageVisibility" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "quoteRequestId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "closedById" UUID,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderUserId" UUID,
    "visibility" "MessageVisibility" NOT NULL,
    "body" TEXT NOT NULL,
    "idempotencyKeyHash" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_quoteRequestId_key" ON "conversations"("quoteRequestId");

-- CreateIndex
CREATE INDEX "conversations_clientId_status_updatedAt_idx" ON "conversations"("clientId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "conversations_status_updatedAt_idx" ON "conversations"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_quoteRequestId_clientId_key" ON "conversations"("quoteRequestId", "clientId");

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_createdAt_id_idx" ON "conversation_messages"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_visibility_createdAt_i_idx" ON "conversation_messages"("conversationId", "visibility", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_conversationId_senderUserId_idempoten_key" ON "conversation_messages"("conversationId", "senderUserId", "idempotencyKeyHash");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_quoteRequestId_clientId_fkey" FOREIGN KEY ("quoteRequestId", "clientId") REFERENCES "quote_requests"("id", "clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "price_list_items_priceListId_catalogItemId_validFrom_validUntil" RENAME TO "price_list_items_priceListId_catalogItemId_validFrom_validU_idx";
