-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuoteRequestOrigin" AS ENUM ('PUBLIC_FORM', 'STAFF_CREATED');

-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA_EN_PROYECTO');

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "userId" UUID,
    "displayName" VARCHAR(180) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "emailNormalized" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(40),
    "roleTitle" VARCHAR(120),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" UUID NOT NULL,
    "folio" VARCHAR(24) NOT NULL,
    "clientId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "currentAssigneeId" UUID,
    "origin" "QuoteRequestOrigin" NOT NULL,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'RECIBIDA',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_request_details" (
    "id" UUID NOT NULL,
    "quoteRequestId" UUID NOT NULL,
    "projectType" VARCHAR(120) NOT NULL,
    "location" VARCHAR(180) NOT NULL,
    "budgetCents" BIGINT,
    "currencyCode" CHAR(3) NOT NULL DEFAULT 'MXN',
    "dimensions" VARCHAR(500),
    "description" TEXT NOT NULL,
    "consentAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_request_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_assignments" (
    "id" UUID NOT NULL,
    "quoteRequestId" UUID NOT NULL,
    "assignedToId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "reason" VARCHAR(500),
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMPTZ(3),

    CONSTRAINT "request_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_status_history" (
    "id" UUID NOT NULL,
    "quoteRequestId" UUID NOT NULL,
    "fromStatus" "QuoteRequestStatus",
    "toStatus" "QuoteRequestStatus" NOT NULL,
    "changedById" UUID,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folio_sequences" (
    "key" VARCHAR(80) NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "folio_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_contacts_userId_key" ON "client_contacts"("userId");

-- CreateIndex
CREATE INDEX "client_contacts_clientId_status_createdAt_idx" ON "client_contacts"("clientId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "client_contacts_clientId_emailNormalized_key" ON "client_contacts"("clientId", "emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_folio_key" ON "quote_requests"("folio");

-- CreateIndex
CREATE INDEX "quote_requests_status_createdAt_idx" ON "quote_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "quote_requests_currentAssigneeId_status_createdAt_idx" ON "quote_requests"("currentAssigneeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "quote_requests_clientId_createdAt_idx" ON "quote_requests"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "quote_request_details_quoteRequestId_key" ON "quote_request_details"("quoteRequestId");

-- CreateIndex
CREATE INDEX "request_assignments_quoteRequestId_assignedAt_idx" ON "request_assignments"("quoteRequestId", "assignedAt");

-- CreateIndex
CREATE INDEX "request_assignments_assignedToId_unassignedAt_assignedAt_idx" ON "request_assignments"("assignedToId", "unassignedAt", "assignedAt");

-- CreateIndex
CREATE INDEX "request_status_history_quoteRequestId_createdAt_idx" ON "request_status_history"("quoteRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "request_status_history_changedById_createdAt_idx" ON "request_status_history"("changedById", "createdAt");

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_currentAssigneeId_fkey" FOREIGN KEY ("currentAssigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_details" ADD CONSTRAINT "quote_request_details_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_assignments" ADD CONSTRAINT "request_assignments_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_assignments" ADD CONSTRAINT "request_assignments_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_assignments" ADD CONSTRAINT "request_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
