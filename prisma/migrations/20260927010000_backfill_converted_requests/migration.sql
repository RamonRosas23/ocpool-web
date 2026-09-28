-- Expedientes cuya aceptación ya se convirtió en proyecto pero cuya solicitud se quedó en ACEPTADA:
-- la conversión no movía el estado de la solicitud. Se cierran como CONVERTIDA_EN_PROYECTO y se deja
-- constancia en su historial (con la fecha y el autor de la creación del proyecto).
INSERT INTO "request_status_history" ("id", "quoteRequestId", "fromStatus", "toStatus", "changedById", "reason", "createdAt")
SELECT gen_random_uuid(), qr."id", 'ACEPTADA', 'CONVERTIDA_EN_PROYECTO', p."createdById", 'Proyecto ' || p."folio" || ' creado (estado corregido).', p."createdAt"
FROM "quote_requests" qr
JOIN "projects" p ON p."quoteRequestId" = qr."id"
WHERE qr."status" = 'ACEPTADA';

UPDATE "quote_requests" qr
SET "status" = 'CONVERTIDA_EN_PROYECTO'
FROM "projects" p
WHERE p."quoteRequestId" = qr."id" AND qr."status" = 'ACEPTADA';
