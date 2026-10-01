CREATE TABLE "quote_version_views" (
    "quoteVersionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstViewedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastViewedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_version_views_pkey" PRIMARY KEY ("quoteVersionId", "userId")
);

CREATE INDEX "quote_version_views_userId_lastViewedAt_idx"
    ON "quote_version_views"("userId", "lastViewedAt");

ALTER TABLE "quote_version_views"
    ADD CONSTRAINT "quote_version_views_quoteVersionId_fkey"
    FOREIGN KEY ("quoteVersionId") REFERENCES "quote_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_version_views"
    ADD CONSTRAINT "quote_version_views_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_status_history"
    ALTER COLUMN "reason" TYPE VARCHAR(1200);
