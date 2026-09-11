-- A pointer must reference a version belonging to the same quote, not merely
-- any existing version UUID.
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_working_version_same_quote_fk"
    FOREIGN KEY ("workingVersionId", "id") REFERENCES "quote_versions" ("id", "quoteId") ON DELETE SET NULL ("workingVersionId") ON UPDATE CASCADE,
  ADD CONSTRAINT "quotes_published_version_same_quote_fk"
    FOREIGN KEY ("publishedVersionId", "id") REFERENCES "quote_versions" ("id", "quoteId") ON DELETE SET NULL ("publishedVersionId") ON UPDATE CASCADE;
