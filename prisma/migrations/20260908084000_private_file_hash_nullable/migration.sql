ALTER TABLE "storage_objects" DROP CONSTRAINT "storage_objects_sha256_ck";
ALTER TABLE "storage_objects" ALTER COLUMN "sha256" DROP NOT NULL;
ALTER TABLE "storage_objects"
  ADD CONSTRAINT "storage_objects_sha256_ck" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9A-Fa-f]{64}$');
