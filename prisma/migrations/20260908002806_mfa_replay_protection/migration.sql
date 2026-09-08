-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "mfaVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfaLastAcceptedCounter" INTEGER;
