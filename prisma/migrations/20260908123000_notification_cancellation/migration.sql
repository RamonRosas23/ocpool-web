-- Unsupported or invalid events remain traceable without fabricating a recipient.
ALTER TABLE "notification_deliveries"
  ALTER COLUMN "recipientAddressHash" DROP NOT NULL;

ALTER TABLE "notification_deliveries"
  ADD COLUMN "cancelReason" VARCHAR(80);

ALTER TABLE "notification_deliveries"
  DROP CONSTRAINT "notification_deliveries_recipient_hash_ck",
  DROP CONSTRAINT "notification_deliveries_email_recipient_ck";

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_recipient_hash_ck"
    CHECK ("recipientAddressHash" IS NULL OR "recipientAddressHash" ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "notification_deliveries_email_recipient_ck"
    CHECK ("channel" <> 'EMAIL' OR "status" = 'CANCELLED' OR "recipientAddressCiphertext" IS NOT NULL),
  ADD CONSTRAINT "notification_deliveries_cancel_reason_ck"
    CHECK (
      ("status" = 'CANCELLED' AND "cancelReason" IN ('UNSUPPORTED_EVENT', 'INVALID_PAYLOAD', 'INVALID_RECIPIENT', 'INVALID_RECIPIENT_SCOPE', 'INTERNAL_VISIBILITY', 'NO_RECIPIENT'))
      OR ("status" <> 'CANCELLED' AND "cancelReason" IS NULL)
    );
