-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_published_version_same_quote_fk";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_working_version_same_quote_fk";
