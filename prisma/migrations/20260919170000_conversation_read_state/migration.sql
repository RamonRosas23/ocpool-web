-- W1-01: per-actor conversation read position (ConversationReadState), so
-- the staff dashboard can derive a real "cliente respondió" reason instead
-- of an opaque score. Pure expand -- no existing table/column touched.
--
-- As in 20260919160000_d1_target_model_v1 (and the two restore migrations
-- before it), `prisma migrate diff` proposed DROP CONSTRAINT for the two
-- composite FKs from 20260911094000_quote_pointer_integrity that have no
-- declarative representation in schema.prisma. Those DROP statements were
-- removed from the generated script rather than dropping and re-adding them.

-- CreateTable
CREATE TABLE "conversation_read_states" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastReadMessageId" UUID,
    "lastReadAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversation_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_read_states_userId_lastReadAt_idx" ON "conversation_read_states"("userId", "lastReadAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_read_states_conversationId_userId_key" ON "conversation_read_states"("conversationId", "userId");

-- AddForeignKey
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_lastReadMessageId_fkey" FOREIGN KEY ("lastReadMessageId") REFERENCES "conversation_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
