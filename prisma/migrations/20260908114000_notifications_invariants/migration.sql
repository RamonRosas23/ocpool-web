-- Domain invariants that Prisma cannot express in the schema model.
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_attempts_ck" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "notification_deliveries_recipient_hash_ck" CHECK ("recipientAddressHash" ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "notification_deliveries_template_key_ck" CHECK ("templateKey" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  ADD CONSTRAINT "notification_deliveries_template_version_ck" CHECK ("templateVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  ADD CONSTRAINT "notification_deliveries_email_recipient_ck" CHECK ("channel" <> 'EMAIL' OR "recipientAddressCiphertext" IS NOT NULL),
  ADD CONSTRAINT "notification_deliveries_processing_started_ck" CHECK ("status" <> 'PROCESSING' OR "processingStartedAt" IS NOT NULL),
  ADD CONSTRAINT "notification_deliveries_sent_processed_ck" CHECK ("status" <> 'SENT' OR "processedAt" IS NOT NULL);
