-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuoteVersionStatus" AS ENUM ('BORRADOR', 'EN_REVISION', 'ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA');

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateTable
CREATE TABLE "catalog_categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" VARCHAR(500),
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "parentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "unit" VARCHAR(40) NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "categoryId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "status" "PriceListStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "quoteRequestId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "currentVersionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_versions" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "QuoteVersionStatus" NOT NULL DEFAULT 'BORRADOR',
    "currencyCode" CHAR(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3),
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "taxableTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line_snapshots" (
    "id" UUID NOT NULL,
    "quoteVersionId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "catalogItemCode" VARCHAR(64) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "unit" VARCHAR(40) NOT NULL,
    "quantityMilliunits" BIGINT NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "discountBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "taxableMinor" BIGINT NOT NULL DEFAULT 0,
    "taxBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "quote_line_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_status_history" (
    "id" UUID NOT NULL,
    "quoteVersionId" UUID NOT NULL,
    "fromStatus" "QuoteVersionStatus",
    "toStatus" "QuoteVersionStatus" NOT NULL,
    "changedById" UUID,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quote_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_categories_code_key" ON "catalog_categories"("code");
CREATE INDEX "catalog_categories_parentId_status_sortOrder_idx" ON "catalog_categories"("parentId", "status", "sortOrder");
CREATE INDEX "catalog_categories_status_sortOrder_name_idx" ON "catalog_categories"("status", "sortOrder", "name");
CREATE UNIQUE INDEX "catalog_items_code_key" ON "catalog_items"("code");
CREATE INDEX "catalog_items_status_name_idx" ON "catalog_items"("status", "name");
CREATE INDEX "catalog_items_categoryId_status_name_idx" ON "catalog_items"("categoryId", "status", "name");
CREATE UNIQUE INDEX "price_lists_code_key" ON "price_lists"("code");
CREATE INDEX "price_lists_currencyCode_status_validFrom_idx" ON "price_lists"("currencyCode", "status", "validFrom");
CREATE UNIQUE INDEX "price_list_items_priceListId_catalogItemId_validFrom_key" ON "price_list_items"("priceListId", "catalogItemId", "validFrom");
CREATE INDEX "price_list_items_priceListId_catalogItemId_validFrom_validUntil_idx" ON "price_list_items"("priceListId", "catalogItemId", "validFrom", "validUntil");
CREATE UNIQUE INDEX "quotes_currentVersionId_key" ON "quotes"("currentVersionId");
CREATE UNIQUE INDEX "quotes_quoteRequestId_key" ON "quotes"("quoteRequestId");
CREATE INDEX "quotes_clientId_createdAt_idx" ON "quotes"("clientId", "createdAt");
CREATE UNIQUE INDEX "quote_versions_quoteId_versionNumber_key" ON "quote_versions"("quoteId", "versionNumber");
CREATE INDEX "quote_versions_quoteId_status_createdAt_idx" ON "quote_versions"("quoteId", "status", "createdAt");
CREATE INDEX "quote_versions_createdById_createdAt_idx" ON "quote_versions"("createdById", "createdAt");
CREATE INDEX "quote_line_snapshots_quoteVersionId_idx" ON "quote_line_snapshots"("quoteVersionId");
CREATE INDEX "quote_line_snapshots_catalogItemId_quoteVersionId_idx" ON "quote_line_snapshots"("catalogItemId", "quoteVersionId");
CREATE INDEX "quote_status_history_quoteVersionId_createdAt_idx" ON "quote_status_history"("quoteVersionId", "createdAt");
CREATE INDEX "quote_status_history_changedById_createdAt_idx" ON "quote_status_history"("changedById", "createdAt");
CREATE UNIQUE INDEX "quote_requests_id_clientId_key" ON "quote_requests"("id", "clientId");

-- AddForeignKey
ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_quoteRequestId_clientId_fkey" FOREIGN KEY ("quoteRequestId", "clientId") REFERENCES "quote_requests"("id", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "quote_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_line_snapshots" ADD CONSTRAINT "quote_line_snapshots_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "quote_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_line_snapshots" ADD CONSTRAINT "quote_line_snapshots_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_status_history" ADD CONSTRAINT "quote_status_history_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "quote_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_status_history" ADD CONSTRAINT "quote_status_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Integrity constraints intentionally remain in PostgreSQL so service bugs cannot persist impossible commercial states.
ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]*$');
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]*$');
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_currency_code_check" CHECK ("currencyCode" ~ '^[A-Z]{3}$');
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_validity_check" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_unit_price_check" CHECK ("unitPriceMinor" BETWEEN 0 AND 9999999999999999);
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_validity_check" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_no_overlap" EXCLUDE USING gist (
    "priceListId" WITH =,
    "catalogItemId" WITH =,
    tstzrange("validFrom", COALESCE("validUntil", 'infinity'::timestamptz), '[)') WITH &&
);
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_version_number_check" CHECK ("versionNumber" > 0);
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_currency_code_check" CHECK ("currencyCode" ~ '^[A-Z]{3}$');
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_totals_check" CHECK (
    "subtotalMinor" >= 0 AND "discountTotalMinor" >= 0 AND "taxableTotalMinor" >= 0 AND "taxTotalMinor" >= 0 AND "totalMinor" >= 0
    AND "discountTotalMinor" <= "subtotalMinor"
    AND "taxableTotalMinor" = "subtotalMinor" - "discountTotalMinor"
    AND "totalMinor" = "taxableTotalMinor" + "taxTotalMinor"
);
ALTER TABLE "quote_line_snapshots" ADD CONSTRAINT "quote_line_snapshots_quantity_check" CHECK ("quantityMilliunits" > 0 AND "quantityMilliunits" <= 1000000000000);
ALTER TABLE "quote_line_snapshots" ADD CONSTRAINT "quote_line_snapshots_currency_code_check" CHECK ("currencyCode" ~ '^[A-Z]{3}$');
ALTER TABLE "quote_line_snapshots" ADD CONSTRAINT "quote_line_snapshots_basis_points_check" CHECK ("discountBasisPoints" BETWEEN 0 AND 10000 AND "taxBasisPoints" BETWEEN 0 AND 10000);
ALTER TABLE "quote_line_snapshots" ADD CONSTRAINT "quote_line_snapshots_amounts_check" CHECK (
    "unitPriceMinor" >= 0 AND "discountMinor" >= 0 AND "taxableMinor" >= 0 AND "taxMinor" >= 0 AND "subtotalMinor" >= 0 AND "totalMinor" >= 0
    AND "discountMinor" <= "subtotalMinor"
    AND "taxableMinor" = "subtotalMinor" - "discountMinor"
    AND "totalMinor" = "taxableMinor" + "taxMinor"
);
