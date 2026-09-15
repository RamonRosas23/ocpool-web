-- AlterEnum
ALTER TYPE "QuoteApprovalType" ADD VALUE 'SPECIAL_CONCEPT';

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_published_version_same_quote_fk";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_working_version_same_quote_fk";

-- DropIndex
DROP INDEX "quotes_publishedVersionId_idx";

-- DropIndex
DROP INDEX "quotes_workingVersionId_idx";

-- AlterTable
ALTER TABLE "quote_line_snapshots" ADD COLUMN     "specialReason" VARCHAR(300),
ALTER COLUMN "catalogItemId" DROP NOT NULL,
ALTER COLUMN "catalogItemCode" DROP NOT NULL;
