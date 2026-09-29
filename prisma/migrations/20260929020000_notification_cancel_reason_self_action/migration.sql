-- Acción propia: quien toma una solicitud o el archivo que el propio cliente subió ya no generan correo
-- para sí mismos (spec 2026-09-29-notificaciones-tiempo-real-design §8.1).
ALTER TABLE "notification_deliveries"
  DROP CONSTRAINT "notification_deliveries_cancel_reason_ck";

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_cancel_reason_ck"
    CHECK (
      ("status" = 'CANCELLED' AND "cancelReason" IN ('UNSUPPORTED_EVENT', 'INVALID_PAYLOAD', 'INVALID_RECIPIENT', 'INVALID_RECIPIENT_SCOPE', 'INTERNAL_VISIBILITY', 'NO_RECIPIENT', 'CONTACT_EMAIL_CHANGED', 'SELF_ACTION'))
      OR ("status" <> 'CANCELLED' AND "cancelReason" IS NULL)
    );
