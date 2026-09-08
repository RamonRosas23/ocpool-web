ALTER TABLE "file_attachments"
  ADD COLUMN "reservationKeyHash" CHAR(64),
  ADD COLUMN "reservationExpiresAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "file_attachments_uploadedById_reservationKeyHash_key"
  ON "file_attachments"("uploadedById", "reservationKeyHash");

CREATE INDEX "file_attachments_status_reservationExpiresAt_idx"
  ON "file_attachments"("status", "reservationExpiresAt");
