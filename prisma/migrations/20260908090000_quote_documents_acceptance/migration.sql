-- CreateEnum
CREATE TYPE "GeneratedDocumentType" AS ENUM ('QUOTE_PDF');

-- CreateEnum
CREATE TYPE "GeneratedDocumentStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETED');

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "quoteVersionId" UUID NOT NULL,
    "storageObjectId" UUID,
    "documentType" "GeneratedDocumentType" NOT NULL DEFAULT 'QUOTE_PDF',
    "status" "GeneratedDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "templateVersion" VARCHAR(64) NOT NULL,
    "contentType" VARCHAR(120) NOT NULL DEFAULT 'application/pdf',
    "byteSize" BIGINT,
    "sha256" CHAR(64),
    "failureCode" VARCHAR(120),
    "generatedAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_acceptances" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "quoteVersionId" UUID NOT NULL,
    "generatedDocumentId" UUID NOT NULL,
    "acceptedById" UUID NOT NULL,
    "documentSha256" CHAR(64) NOT NULL,
    "signerName" VARCHAR(180) NOT NULL,
    "termsVersion" VARCHAR(64) NOT NULL,
    "idempotencyKeyHash" CHAR(64) NOT NULL,
    "ipFingerprint" CHAR(64),
    "userAgentFingerprint" CHAR(64),
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_storageObjectId_key" ON "generated_documents"("storageObjectId");
CREATE UNIQUE INDEX "generated_documents_quoteVersionId_documentType_key" ON "generated_documents"("quoteVersionId", "documentType");
CREATE INDEX "generated_documents_quoteId_status_documentType_idx" ON "generated_documents"("quoteId", "status", "documentType");
CREATE INDEX "generated_documents_status_updatedAt_idx" ON "generated_documents"("status", "updatedAt");

CREATE UNIQUE INDEX "quote_acceptances_generatedDocumentId_key" ON "quote_acceptances"("generatedDocumentId");
CREATE UNIQUE INDEX "quote_acceptances_quoteVersionId_quoteId_key" ON "quote_acceptances"("quoteVersionId", "quoteId");
CREATE UNIQUE INDEX "quote_acceptances_acceptedById_idempotencyKeyHash_key" ON "quote_acceptances"("acceptedById", "idempotencyKeyHash");
CREATE INDEX "quote_acceptances_quoteId_acceptedAt_idx" ON "quote_acceptances"("quoteId", "acceptedAt");
CREATE INDEX "quote_acceptances_acceptedById_acceptedAt_idx" ON "quote_acceptances"("acceptedById", "acceptedAt");

-- Required for the scoped composite foreign keys declared by the application model.
CREATE UNIQUE INDEX "quote_versions_id_quoteId_key" ON "quote_versions"("id", "quoteId");

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_quoteVersionId_quoteId_fkey" FOREIGN KEY ("quoteVersionId", "quoteId") REFERENCES "quote_versions"("id", "quoteId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_quoteVersionId_quoteId_fkey" FOREIGN KEY ("quoteVersionId", "quoteId") REFERENCES "quote_versions"("id", "quoteId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_generatedDocumentId_fkey" FOREIGN KEY ("generatedDocumentId") REFERENCES "generated_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants that Prisma cannot express in the schema model.
ALTER TABLE "generated_documents"
  ADD CONSTRAINT "generated_documents_content_type_ck" CHECK ("contentType" = 'application/pdf'),
  ADD CONSTRAINT "generated_documents_byte_size_ck" CHECK ("byteSize" IS NULL OR "byteSize" > 0),
  ADD CONSTRAINT "generated_documents_sha256_ck" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "generated_documents_ready_ck" CHECK (
    "status" <> 'READY'
    OR ("storageObjectId" IS NOT NULL AND "byteSize" IS NOT NULL AND "sha256" IS NOT NULL AND "readyAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "generated_documents_deleted_at_ck" CHECK ("status" <> 'DELETED' OR "deletedAt" IS NOT NULL);

ALTER TABLE "quote_acceptances"
  ADD CONSTRAINT "quote_acceptances_document_sha256_ck" CHECK ("documentSha256" ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "quote_acceptances_signer_name_ck" CHECK (length(trim("signerName")) > 0),
  ADD CONSTRAINT "quote_acceptances_terms_version_ck" CHECK ("termsVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  ADD CONSTRAINT "quote_acceptances_idempotency_hash_ck" CHECK ("idempotencyKeyHash" ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "quote_acceptances_ip_fingerprint_ck" CHECK ("ipFingerprint" IS NULL OR "ipFingerprint" ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "quote_acceptances_user_agent_fingerprint_ck" CHECK ("userAgentFingerprint" IS NULL OR "userAgentFingerprint" ~ '^[0-9A-Fa-f]{64}$');
