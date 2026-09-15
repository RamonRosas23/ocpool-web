-- AlterEnum
ALTER TYPE "QuoteApprovalType" ADD VALUE 'SPECIAL_CONCEPT';

-- DropIndex
-- Redundant plain indexes: quotes_workingVersionId_key/quotes_publishedVersionId_key
-- (declared via @unique in schema.prisma) already index these columns.
DROP INDEX "quotes_publishedVersionId_idx";

-- DropIndex
DROP INDEX "quotes_workingVersionId_idx";

-- NOTE: quotes_working_version_same_quote_fk / quotes_published_version_same_quote_fk
-- (added by 20260911094000_quote_pointer_integrity) are hand-written composite FKs with
-- no declarative representation in schema.prisma. Prisma's diff engine does not know about
-- them and would otherwise emit DROP CONSTRAINT statements here — deliberately omitted so
-- these integrity constraints survive a fresh `prisma migrate deploy` from scratch.

-- AlterTable
ALTER TABLE "quote_line_snapshots" ADD COLUMN     "specialReason" VARCHAR(300),
ALTER COLUMN "catalogItemId" DROP NOT NULL,
ALTER COLUMN "catalogItemCode" DROP NOT NULL;
