-- CreateEnum
CREATE TYPE "QuoteRequestProjectStage" AS ENUM ('IDEA', 'SITE_READY', 'UNDER_CONSTRUCTION', 'REMODEL', 'EQUIPMENT_ONLY', 'UNSURE');

-- CreateEnum
CREATE TYPE "QuoteRequestTimeline" AS ENUM ('ASAP', 'ONE_TO_THREE_MONTHS', 'THREE_TO_SIX_MONTHS', 'SIX_PLUS_MONTHS', 'UNSURE');

-- CreateEnum
CREATE TYPE "QuoteRequestBudgetRange" AS ENUM ('UNDER_250K', 'FROM_250K_TO_500K', 'FROM_500K_TO_1M', 'OVER_1M', 'UNSURE');

-- AlterTable
ALTER TABLE "quote_request_details" ADD COLUMN     "budgetRange" "QuoteRequestBudgetRange",
ADD COLUMN     "projectStage" "QuoteRequestProjectStage",
ADD COLUMN     "timeline" "QuoteRequestTimeline";
