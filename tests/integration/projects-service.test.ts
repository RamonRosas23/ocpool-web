import { describe, expect, it } from 'vitest';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';
import { acceptCustomerQuote } from '@/server/modules/quote-documents/acceptance-service';
import { addProjectChecklistItem, convertQuoteAcceptanceToProject, getProjectWorkspace, setProjectChecklistItemCompletion, setProjectHandoffStatus } from '@/server/modules/projects/service';
import type { PrivateStorage } from '@/server/modules/private-files/storage';

class MemoryProjectStorage implements PrivateStorage {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async ensureBucket(): Promise<void> {}
  async put({ key, body, contentType }: { key: string; body: Uint8Array; contentType: string }): Promise<void> { this.objects.set(key, { body, contentType }); }
  async createUploadUrl(): Promise<string> { return 'memory://upload'; }
  async createDownloadUrl(): Promise<string> { return 'memory://download'; }
  async head(key: string) { const object = this.objects.get(key); return object ? { contentLength: object.body.byteLength, contentType: object.contentType, etag: null } : null; }
  async read(key: string): Promise<Uint8Array> { const object = this.objects.get(key); if (!object) throw new Error('missing'); return object.body; }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
}

function employeeActor(userId: string, roles: string[] = ['sales']): Actor {
  return { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(roles), mfaVerified: true };
}

function customerActor(userId: string, clientId: string): Actor {
  return { userId, type: 'CUSTOMER', clientId, permissionKeys: permissionKeysForRoles(['customer']), mfaVerified: true };
}

describe('project handoff service (J1)', () => {
  it('converts an acceptance into exactly one project, idempotently, and supports the handoff workspace commands', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const storage = new MemoryProjectStorage();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-20T15:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `project-service-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Project handoff ${suffix}`, email: `project-handoff-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Project handoff fixture', consentAt: now },
    }, { prisma, now });
    const salesUser = await prisma.user.create({ data: { email: `project-sales-${suffix}@example.test`, emailNormalized: `project-sales-${suffix}@example.test`, displayName: 'Project sales', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const outsiderUser = await prisma.user.create({ data: { email: `project-outsider-${suffix}@example.test`, emailNormalized: `project-outsider-${suffix}@example.test`, displayName: 'Project outsider', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const customerUser = await prisma.user.create({ data: { email: `project-customer-${suffix}@example.test`, emailNormalized: `project-customer-${suffix}@example.test`, displayName: 'Project customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
    const category = await prisma.catalogCategory.create({ data: { code: `PROJECT-${suffix}`, name: 'Project fixture' } });
    const item = await prisma.catalogItem.create({ data: { code: `PROJECT-ITEM-${suffix}`, name: 'Project item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `PROJECT-PRICE-${suffix}`, name: 'Project prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 100_000n, validFrom: now } });
    let quoteId: string | null = null;
    let projectId: string | null = null;

    const sales = employeeActor(salesUser.id);
    // Sin scope sobre este expediente (nunca fue su responsable ni tiene lectura global) --
    // exactamente el actor que la separación de scope de requireStaffRequestReadScope debe bloquear.
    const outsider = employeeActor(outsiderUser.id);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: salesUser.id } });
      const created = await createQuoteVersion(sales, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1', taxBasisPoints: 1600 }] }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(sales, created.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(sales, created.versionId, 'ENVIADA', { prisma, now });
      await generateQuotePdf(sales, created.versionId, { prisma, storage, now });

      const customer = customerActor(customerUser.id, request.clientId);
      const acceptance = await acceptCustomerQuote(customer, quoteId, { signerName: 'Ana López Rivera', termsVersion: 'v1', idempotencyKey: `project-accept-${suffix}` }, { prisma, storage, now });

      // Sin permiso: la acción debe permanecer invisible/bloqueada, no fallar de forma confusa.
      await expect(convertQuoteAcceptanceToProject(employeeActor(salesUser.id, []), acceptance.id, {}, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // Fuera de scope: un empleado sin relación con este expediente no puede convertirlo.
      await expect(convertQuoteAcceptanceToProject(outsider, acceptance.id, {}, { prisma, now })).rejects.toThrow();

      const project = await convertQuoteAcceptanceToProject(sales, acceptance.id, { checklistLabels: ['Agendar visita de medición', 'Confirmar accesos en sitio'] }, { prisma, now });
      projectId = project.id;
      expect(project).toMatchObject({ status: 'EN_TRANSICION', completedAt: null });
      expect(project.folio).toMatch(/^PRJ-\d{4}-\d{6}$/u);

      // Idempotencia real: reintentar la conversión (doble clic, reintento de red) regresa el mismo
      // proyecto en vez de fallar o crear un segundo -- @@unique([quoteAcceptanceId]) lo garantiza.
      const replay = await convertQuoteAcceptanceToProject(sales, acceptance.id, {}, { prisma, now });
      expect(replay.id).toBe(project.id);
      expect(await prisma.project.count({ where: { quoteAcceptanceId: acceptance.id } })).toBe(1);

      const workspace = await getProjectWorkspace(sales, project.id, { prisma, now });
      expect(workspace).toMatchObject({
        folio: project.folio,
        status: 'EN_TRANSICION',
        client: { displayName: `Project handoff ${suffix}` },
        quoteRequest: { folio: request.folio, projectType: 'Residencial', location: 'Culiacán' },
        acceptedVersion: { versionNumber: 1, totalMinor: '116000', signerName: 'Ana López Rivera' },
      });
      expect(workspace.checklistItems).toHaveLength(2);
      expect(workspace.checklistItems.map((entry) => entry.label)).toEqual(['Agendar visita de medición', 'Confirmar accesos en sitio']);
      expect(workspace.activity.map((entry) => entry.action)).toContain('project.created');

      // Scope fuera del expediente: consultar el workspace tampoco debe funcionar para el outsider.
      await expect(getProjectWorkspace(outsider, project.id, { prisma, now })).rejects.toThrow();

      await addProjectChecklistItem(sales, project.id, 'Entregar copia de la propuesta al equipo de obra', { prisma, now });
      const firstItemId = workspace.checklistItems[0].id;
      await setProjectChecklistItemCompletion(sales, project.id, firstItemId, true, { prisma, now });
      const afterChecklist = await getProjectWorkspace(sales, project.id, { prisma, now });
      expect(afterChecklist.checklistItems).toHaveLength(3);
      expect(afterChecklist.checklistItems.find((entry) => entry.id === firstItemId)?.completedAt).not.toBeNull();

      await setProjectHandoffStatus(sales, project.id, 'COMPLETADO', { prisma, now });
      const completed = await getProjectWorkspace(sales, project.id, { prisma, now });
      expect(completed.status).toBe('COMPLETADO');
      expect(completed.completedAt).not.toBeNull();
      expect(completed.activity.map((entry) => entry.action)).toContain('project.completed');

      await setProjectHandoffStatus(sales, project.id, 'EN_TRANSICION', { prisma, now });
      const reopened = await getProjectWorkspace(sales, project.id, { prisma, now });
      expect(reopened.status).toBe('EN_TRANSICION');
      expect(reopened.completedAt).toBeNull();
    } finally {
      if (projectId) {
        await prisma.projectChecklistItem.deleteMany({ where: { projectId } });
        await prisma.project.delete({ where: { id: projectId } });
      }
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const documents = await prisma.generatedDocument.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } });
      await prisma.quoteAcceptance.deleteMany({ where: { quoteId: { in: (await prisma.quote.findMany({ where: { quoteRequestId: request.quoteRequestId }, select: { id: true } })).map(({ id }) => id) } } });
      await prisma.generatedDocument.deleteMany({ where: { id: { in: documents.map(({ id }) => id) } } });
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [request.quoteRequestId, ...(quoteId ? [quoteId] : []), ...(projectId ? [projectId] : [])] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [request.quoteRequestId, ...(quoteId ? [quoteId] : []), ...versionIds, ...(projectId ? [projectId] : [])] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.user.deleteMany({ where: { id: { in: [salesUser.id, outsiderUser.id, customerUser.id] } } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
