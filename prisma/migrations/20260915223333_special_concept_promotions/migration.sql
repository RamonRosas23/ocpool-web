-- NOTE: quotes_working_version_same_quote_fk / quotes_published_version_same_quote_fk
-- have no declarative representation in schema.prisma (see 20260915192000's own note),
-- so Prisma's diff proposed dropping them again here — deliberately omitted, same as
-- in 20260915191152.

-- CreateTable
CREATE TABLE "special_concept_promotions" (
    "id" UUID NOT NULL,
    "normalizedName" VARCHAR(180) NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "promotedById" UUID NOT NULL,
    "promotedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "special_concept_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "special_concept_promotions_catalogItemId_idx" ON "special_concept_promotions"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "special_concept_promotions_normalizedName_unit_key" ON "special_concept_promotions"("normalizedName", "unit");

-- AddForeignKey
ALTER TABLE "special_concept_promotions" ADD CONSTRAINT "special_concept_promotions_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_concept_promotions" ADD CONSTRAINT "special_concept_promotions_promotedById_fkey" FOREIGN KEY ("promotedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
