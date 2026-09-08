-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('MINIO');

-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'PASSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FileAttachmentStatus" AS ENUM ('PENDING_SCAN', 'AVAILABLE', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('REFERENCE_IMAGE', 'TECHNICAL_DOCUMENT', 'CLIENT_DOCUMENT', 'INTERNAL_DOCUMENT');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateTable
CREATE TABLE "storage_objects" (
    "id" UUID NOT NULL,
    "provider" "StorageProvider" NOT NULL DEFAULT 'MINIO',
    "storageKey" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(120) NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "etag" VARCHAR(128),
    "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
    "scannerName" VARCHAR(120),
    "scanReason" VARCHAR(300),
    "scannedAt" TIMESTAMPTZ(3),
    "verifiedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_attachments" (
    "id" UUID NOT NULL,
    "quoteRequestId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "storageObjectId" UUID NOT NULL,
    "originalFileName" VARCHAR(180) NOT NULL,
    "category" "FileCategory" NOT NULL,
    "visibility" "FileVisibility" NOT NULL,
    "status" "FileAttachmentStatus" NOT NULL DEFAULT 'PENDING_SCAN',
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storage_objects_storageKey_key" ON "storage_objects"("storageKey");

-- CreateIndex
CREATE INDEX "storage_objects_scanStatus_createdAt_idx" ON "storage_objects"("scanStatus", "createdAt");

-- CreateIndex
CREATE INDEX "storage_objects_deletedAt_createdAt_idx" ON "storage_objects"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_attachments_storageObjectId_key" ON "file_attachments"("storageObjectId");

-- CreateIndex
CREATE INDEX "file_attachments_quoteRequestId_status_createdAt_idx" ON "file_attachments"("quoteRequestId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "file_attachments_clientId_visibility_status_createdAt_idx" ON "file_attachments"("clientId", "visibility", "status", "createdAt");

-- CreateIndex
CREATE INDEX "file_attachments_uploadedById_createdAt_idx" ON "file_attachments"("uploadedById", "createdAt");

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_quoteRequestId_clientId_fkey" FOREIGN KEY ("quoteRequestId", "clientId") REFERENCES "quote_requests"("id", "clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "storage_objects"
  ADD CONSTRAINT "storage_objects_byte_size_ck" CHECK ("byteSize" > 0 AND "byteSize" <= 26214400),
  ADD CONSTRAINT "storage_objects_storage_key_ck" CHECK ("storageKey" LIKE 'private-files/%'),
  ADD CONSTRAINT "storage_objects_sha256_ck" CHECK ("sha256" ~ '^[0-9A-Fa-f]{64}$');

ALTER TABLE "file_attachments"
  ADD CONSTRAINT "file_attachments_original_file_name_ck" CHECK (length(trim("originalFileName")) > 0),
  ADD CONSTRAINT "file_attachments_internal_visibility_ck" CHECK ("category" <> 'INTERNAL_DOCUMENT' OR "visibility" = 'INTERNAL');
