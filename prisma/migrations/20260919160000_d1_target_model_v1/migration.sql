-- D1-01/02/03/04: target model (revision/digest/publishedAt/supersededAt,
-- structured content + sections, versioned policy/tax/terms, publication as
-- a first-class record). Pure expand + backfill; nothing existing is
-- removed or renamed. See docs/ocpool-commercial-v2/plans/2026-09-19-ocpool-commercial-v3-continuacion.md §3.
--
-- Note: this diff was generated with `prisma migrate diff` (this sandbox
-- cannot run the interactive `prisma migrate dev`). As in
-- 20260915192000_restore_quote_pointer_integrity_constraints and
-- 20260917193800_restore_quote_pointer_integrity_constraints_2, Prisma's
-- diff engine proposed DROP CONSTRAINT for the two composite FKs added by
-- 20260911094000_quote_pointer_integrity (they have no declarative
-- representation in schema.prisma). This time the DROP statements were
-- removed from the generated script instead of dropping and re-adding them,
-- so those constraints are simply left untouched by this migration.

-- CreateEnum
CREATE TYPE "TaxRoundingRule" AS ENUM ('HALF_UP');

-- CreateEnum
CREATE TYPE "QuotePublicationStatus" AS ENUM ('PUBLISHED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "quote_line_snapshots" ADD COLUMN     "baseUnitPriceMinor" BIGINT,
ADD COLUMN     "overrideReason" VARCHAR(300),
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sectionId" UUID;

-- AlterTable
ALTER TABLE "quote_versions" ADD COLUMN     "commercialPolicyId" UUID,
ADD COLUMN     "contentDigest" CHAR(64),
ADD COLUMN     "exclusionsText" TEXT,
ADD COLUMN     "paymentTermsText" TEXT,
ADD COLUMN     "publicNotesText" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMPTZ(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "scopeText" TEXT,
ADD COLUMN     "sourcePriceListId" UUID,
ADD COLUMN     "supersededAt" TIMESTAMPTZ(3),
ADD COLUMN     "taxProfileId" UUID,
ADD COLUMN     "termsVersionId" UUID,
ADD COLUMN     "warrantyText" TEXT;

-- CreateTable
CREATE TABLE "quote_section_snapshots" (
    "id" UUID NOT NULL,
    "quoteVersionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_section_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_policy_versions" (
    "id" UUID NOT NULL,
    "versionTag" VARCHAR(64) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "precision" INTEGER NOT NULL DEFAULT 2,
    "timezone" VARCHAR(64) NOT NULL,
    "discountApprovalThresholdBps" INTEGER NOT NULL DEFAULT 1000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_profile_versions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "ratePercentBasisPoints" INTEGER NOT NULL,
    "roundingRule" "TaxRoundingRule" NOT NULL DEFAULT 'HALF_UP',
    "currencyCode" CHAR(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_terms_versions" (
    "id" UUID NOT NULL,
    "versionTag" VARCHAR(64) NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "privacyMarkdown" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_terms_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_publications" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "quoteVersionId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "termsVersionId" UUID NOT NULL,
    "preflightDigest" CHAR(64) NOT NULL,
    "recipientEmailHash" CHAR(64) NOT NULL,
    "status" "QuotePublicationStatus" NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID NOT NULL,

    CONSTRAINT "quote_publications_pkey" PRIMARY KEY ("id")
);

-- Backfill: deterministic line position from existing `id` insertion order,
-- per version. This preserves the exact order already visible today (it
-- does not reorder anything) and only replaces an implicit ordering that
-- Q1-05 already found unsafe to rely on for merges.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "quoteVersionId" ORDER BY id ASC) - 1 AS rn
  FROM "quote_line_snapshots"
)
UPDATE "quote_line_snapshots" AS q
SET "position" = ranked.rn
FROM ranked
WHERE q.id = ranked.id;

-- Backfill: baseUnitPriceMinor defaults to the already-frozen unitPriceMinor
-- for every existing line (no historical catalog price to distinguish it
-- from before this column existed; this is the safe, non-inventing default).
UPDATE "quote_line_snapshots" SET "baseUnitPriceMinor" = "unitPriceMinor" WHERE "baseUnitPriceMinor" IS NULL;

-- Backfill: publishedAt = first time the version actually reached ENVIADA.
UPDATE "quote_versions" AS v
SET "publishedAt" = h."firstSent"
FROM (
  SELECT "quoteVersionId", MIN("createdAt") AS "firstSent"
  FROM "quote_status_history"
  WHERE "toStatus" = 'ENVIADA'
  GROUP BY "quoteVersionId"
) AS h
WHERE v.id = h."quoteVersionId";

-- Backfill: supersededAt = the moment the next version of the same quote
-- first reached ENVIADA, for any version that had itself been sent before.
-- `createVersionFromSent` only ever creates a later version after the prior
-- one was sent, and `publishedVersionId` always tracks the latest version
-- that reached ENVIADA, so this is exact, not a heuristic.
UPDATE "quote_versions" AS v
SET "supersededAt" = nxt."nextSent"
FROM (
  SELECT v1.id AS "versionId", MIN(h2."createdAt") AS "nextSent"
  FROM "quote_versions" v1
  JOIN "quote_versions" v2
    ON v2."quoteId" = v1."quoteId" AND v2."versionNumber" > v1."versionNumber"
  JOIN "quote_status_history" h2
    ON h2."quoteVersionId" = v2.id AND h2."toStatus" = 'ENVIADA'
  WHERE v1."publishedAt" IS NOT NULL
  GROUP BY v1.id
) AS nxt
WHERE v.id = nxt."versionId";

-- CreateIndex
CREATE UNIQUE INDEX "quote_section_snapshots_quoteVersionId_position_key" ON "quote_section_snapshots"("quoteVersionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_policy_versions_versionTag_key" ON "commercial_policy_versions"("versionTag");

-- CreateIndex
CREATE INDEX "commercial_policy_versions_active_createdAt_idx" ON "commercial_policy_versions"("active", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tax_profile_versions_code_key" ON "tax_profile_versions"("code");

-- CreateIndex
CREATE INDEX "tax_profile_versions_active_currencyCode_idx" ON "tax_profile_versions"("active", "currencyCode");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_terms_versions_versionTag_key" ON "commercial_terms_versions"("versionTag");

-- CreateIndex
CREATE INDEX "commercial_terms_versions_active_publishedAt_idx" ON "commercial_terms_versions"("active", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "quote_publications_documentId_key" ON "quote_publications"("documentId");

-- CreateIndex
CREATE INDEX "quote_publications_quoteId_publishedAt_idx" ON "quote_publications"("quoteId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "quote_publications_quoteVersionId_quoteId_key" ON "quote_publications"("quoteVersionId", "quoteId");

-- CreateIndex
CREATE INDEX "quote_line_snapshots_sectionId_idx" ON "quote_line_snapshots"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_line_snapshots_quoteVersionId_position_key" ON "quote_line_snapshots"("quoteVersionId", "position");

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "tax_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_commercialPolicyId_fkey" FOREIGN KEY ("commercialPolicyId") REFERENCES "commercial_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_termsVersionId_fkey" FOREIGN KEY ("termsVersionId") REFERENCES "commercial_terms_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_sourcePriceListId_fkey" FOREIGN KEY ("sourcePriceListId") REFERENCES "price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_snapshots" ADD CONSTRAINT "quote_line_snapshots_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "quote_section_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_section_snapshots" ADD CONSTRAINT "quote_section_snapshots_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "quote_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_policy_versions" ADD CONSTRAINT "commercial_policy_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_terms_versions" ADD CONSTRAINT "commercial_terms_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_publications" ADD CONSTRAINT "quote_publications_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_publications" ADD CONSTRAINT "quote_publications_quoteVersionId_quoteId_fkey" FOREIGN KEY ("quoteVersionId", "quoteId") REFERENCES "quote_versions"("id", "quoteId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_publications" ADD CONSTRAINT "quote_publications_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "generated_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_publications" ADD CONSTRAINT "quote_publications_termsVersionId_fkey" FOREIGN KEY ("termsVersionId") REFERENCES "commercial_terms_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_publications" ADD CONSTRAINT "quote_publications_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
