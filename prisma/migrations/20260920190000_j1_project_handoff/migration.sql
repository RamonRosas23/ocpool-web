-- CreateEnum
CREATE TYPE "ProjectHandoffStatus" AS ENUM ('EN_TRANSICION', 'COMPLETADO');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "folio" VARCHAR(24) NOT NULL,
    "quoteAcceptanceId" UUID NOT NULL,
    "quoteRequestId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "ownerId" UUID,
    "status" "ProjectHandoffStatus" NOT NULL DEFAULT 'EN_TRANSICION',
    "createdById" UUID NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_checklist_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "label" VARCHAR(240) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMPTZ(3),
    "completedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_folio_key" ON "projects"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "projects_quoteAcceptanceId_key" ON "projects"("quoteAcceptanceId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_quoteRequestId_key" ON "projects"("quoteRequestId");

-- CreateIndex
CREATE INDEX "projects_clientId_createdAt_idx" ON "projects"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "projects_ownerId_status_idx" ON "projects"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_checklist_items_projectId_position_key" ON "project_checklist_items"("projectId", "position");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_quoteAcceptanceId_fkey" FOREIGN KEY ("quoteAcceptanceId") REFERENCES "quote_acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
