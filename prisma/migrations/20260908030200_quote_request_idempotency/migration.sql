-- AlterTable
ALTER TABLE "quote_requests" ADD COLUMN "idempotencyKeyHash" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_idempotencyKeyHash_key" ON "quote_requests"("idempotencyKeyHash");
