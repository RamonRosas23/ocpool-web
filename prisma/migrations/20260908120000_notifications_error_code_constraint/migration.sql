-- Delivery error codes are controlled categories, never raw provider responses.
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_last_error_code_ck" CHECK (
    "lastErrorCode" IS NULL
    OR "lastErrorCode" IN ('TEMPORARY_PROVIDER', 'RATE_LIMIT', 'INVALID_RECIPIENT', 'TEMPLATE_ERROR', 'CONFIGURATION')
  );
