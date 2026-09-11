-- Expand quote pointers without removing the legacy currentVersionId yet.
ALTER TABLE "quotes"
  ADD COLUMN "workingVersionId" UUID,
  ADD COLUMN "publishedVersionId" UUID;

-- Preserve the latest customer-visible snapshot as the published pointer.
WITH latest_published AS (
  SELECT DISTINCT ON ("quoteId") "quoteId", "id"
  FROM "quote_versions"
  WHERE "status" IN ('ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA')
  ORDER BY "quoteId", "versionNumber" DESC, "id" DESC
)
UPDATE "quotes" AS quote
SET "publishedVersionId" = latest."id"
FROM latest_published AS latest
WHERE latest."quoteId" = quote."id";

-- A legacy current pointer is working only while it remains editable/reviewable.
UPDATE "quotes" AS quote
SET "workingVersionId" = quote."currentVersionId"
FROM "quote_versions" AS version
WHERE version."id" = quote."currentVersionId"
  AND version."status" IN ('BORRADOR', 'EN_REVISION');

CREATE UNIQUE INDEX "quotes_workingVersionId_key" ON "quotes"("workingVersionId");
CREATE UNIQUE INDEX "quotes_publishedVersionId_key" ON "quotes"("publishedVersionId");
CREATE INDEX "quotes_workingVersionId_idx" ON "quotes"("workingVersionId");
CREATE INDEX "quotes_publishedVersionId_idx" ON "quotes"("publishedVersionId");

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_workingVersionId_fkey" FOREIGN KEY ("workingVersionId") REFERENCES "quote_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "quotes_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "quote_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
