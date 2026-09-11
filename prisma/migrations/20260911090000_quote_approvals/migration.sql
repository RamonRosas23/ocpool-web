-- CreateEnum
CREATE TYPE "QuoteApprovalType" AS ENUM ('DISCOUNT', 'PRICE_OVERRIDE');

-- CreateEnum
CREATE TYPE "QuoteApprovalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "quote_approvals" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "quoteVersionId" UUID NOT NULL,
    "type" "QuoteApprovalType" NOT NULL,
    "status" "QuoteApprovalStatus" NOT NULL DEFAULT 'REQUESTED',
    "policyVersion" VARCHAR(64) NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "thresholdBps" INTEGER,
    "reason" VARCHAR(500),
    "requestedById" UUID NOT NULL,
    "decidedById" UUID,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "quote_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_approvals_quoteVersionId_type_status_idx" ON "quote_approvals"("quoteVersionId", "type", "status");
CREATE INDEX "quote_approvals_quoteId_status_requestedAt_idx" ON "quote_approvals"("quoteId", "status", "requestedAt");
CREATE INDEX "quote_approvals_requestedById_requestedAt_idx" ON "quote_approvals"("requestedById", "requestedAt");
CREATE INDEX "quote_approvals_decidedById_decidedAt_idx" ON "quote_approvals"("decidedById", "decidedAt");
CREATE UNIQUE INDEX "quote_approvals_quoteVersionId_type_digest_key" ON "quote_approvals"("quoteVersionId", "type", "digest");
CREATE UNIQUE INDEX "quote_approvals_active_version_type_key" ON "quote_approvals"("quoteVersionId", "type") WHERE "status" IN ('REQUESTED', 'APPROVED');

-- AddForeignKey
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_quoteVersionId_quoteId_fkey" FOREIGN KEY ("quoteVersionId", "quoteId") REFERENCES "quote_versions"("id", "quoteId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain invariants that Prisma cannot express in the schema model.
ALTER TABLE "quote_approvals"
  ADD CONSTRAINT "quote_approvals_policy_version_ck" CHECK (length(trim("policyVersion")) > 0),
  ADD CONSTRAINT "quote_approvals_digest_ck" CHECK ("digest" ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "quote_approvals_threshold_bps_ck" CHECK ("thresholdBps" IS NULL OR ("thresholdBps" >= 0 AND "thresholdBps" <= 10000)),
  ADD CONSTRAINT "quote_approvals_decision_ck" CHECK (("status" IN ('REQUESTED', 'CANCELLED', 'SUPERSEDED') AND "decidedAt" IS NULL) OR ("status" IN ('APPROVED', 'REJECTED') AND "decidedAt" IS NOT NULL));
