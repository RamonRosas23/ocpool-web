-- Correcting a contact's email mid-flight cancels stale, unregistered-customer
-- deliveries so a corrected address never gets silently skipped (D2-06).
ALTER TABLE "notification_deliveries"
  DROP CONSTRAINT "notification_deliveries_cancel_reason_ck";

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_cancel_reason_ck"
    CHECK (
      ("status" = 'CANCELLED' AND "cancelReason" IN ('UNSUPPORTED_EVENT', 'INVALID_PAYLOAD', 'INVALID_RECIPIENT', 'INVALID_RECIPIENT_SCOPE', 'INTERNAL_VISIBILITY', 'NO_RECIPIENT', 'CONTACT_EMAIL_CHANGED'))
      OR ("status" <> 'CANCELLED' AND "cancelReason" IS NULL)
    );
