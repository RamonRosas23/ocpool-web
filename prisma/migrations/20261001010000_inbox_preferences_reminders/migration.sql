CREATE TYPE "InboxActivityEmail" AS ENUM ('DIGEST', 'OFF');

CREATE TABLE "inbox_preferences" (
    "userId" UUID NOT NULL,
    "soundEnabled" BOOLEAN,
    "desktopEnabled" BOOLEAN NOT NULL DEFAULT false,
    "activityEmail" "InboxActivityEmail" NOT NULL DEFAULT 'DIGEST',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbox_preferences_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "inbox_preferences"
  ADD CONSTRAINT "inbox_preferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inbox_reminders" (
    "key" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbox_reminders_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "notification_deliveries"
  DROP CONSTRAINT "notification_deliveries_cancel_reason_ck";

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_cancel_reason_ck"
    CHECK (
      ("status" = 'CANCELLED' AND "cancelReason" IN (
        'UNSUPPORTED_EVENT',
        'INVALID_PAYLOAD',
        'INVALID_RECIPIENT',
        'INVALID_RECIPIENT_SCOPE',
        'INTERNAL_VISIBILITY',
        'NO_RECIPIENT',
        'CONTACT_EMAIL_CHANGED',
        'SELF_ACTION',
        'ALREADY_READ',
        'INBOX_DIGEST'
      ))
      OR ("status" <> 'CANCELLED' AND "cancelReason" IS NULL)
    );
