ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_body_check"
  CHECK (length(trim("body")) > 0 AND length("body") <= 10000);

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_closed_state_check"
  CHECK (
    ("status" = 'OPEN' AND "closedAt" IS NULL AND "closedById" IS NULL)
    OR
    ("status" = 'CLOSED' AND "closedAt" IS NOT NULL)
  );
