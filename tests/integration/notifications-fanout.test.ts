import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { encryptSecret, fingerprintToken } from '@/server/auth/crypto';
import { readServerEnv } from '@/server/env';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { fanOutNotificationEvent, processNotificationFanoutBatch } from '@/server/modules/notifications/fanout';
import { processNotificationBatch } from '@/server/modules/notifications/worker';
import { resolveNotificationEvent } from '@/server/modules/notifications/event-resolver';
import { mapNotificationEvent } from '@/server/modules/notifications/templates';
import { DEFAULT_COMMERCIAL_V2_FLAGS } from '@/server/flags/commercial-v2';
import type { EmailProvider } from '@/server/modules/notifications/email-provider';

describe('transactional notification fan-out', () => {
  it('resolves every supported commercial audience, preserves snapshots and cancels internal events', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-08T12:00:00.000Z');
    const workerNow = new Date('2000-01-01T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `notification-fanout-${suffix}`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: `Fanout customer ${suffix}`, email: `fanout-customer-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'Notification fanout fixture', consentAt: now },
    }, { prisma, now });
    const [customer, employee] = await Promise.all([
      prisma.user.create({ data: { email: `fanout-portal-${suffix}@example.test`, emailNormalized: `fanout-portal-${suffix}@example.test`, displayName: 'Fanout customer user', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } }),
      prisma.user.create({ data: { email: `fanout-staff-${suffix}@example.test`, emailNormalized: `fanout-staff-${suffix}@example.test`, displayName: 'Fanout staff user', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { currentAssigneeId: employee.id } });
    const conversation = await prisma.conversation.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } });
    const message = await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderUserId: customer.id, visibility: 'CUSTOMER', body: 'Necesito confirmar el alcance del proyecto.' } });
    const internalMessage = await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderUserId: employee.id, visibility: 'INTERNAL', body: 'Nota privada de operación.' } });
    const quote = await prisma.quote.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } });
    const version = await prisma.quoteVersion.create({ data: { quoteId: quote.id, versionNumber: 1, status: 'ACEPTADA', currencyCode: 'MXN', subtotalMinor: 125000n, taxableTotalMinor: 125000n, totalMinor: 125000n, createdById: employee.id } });
    await prisma.quote.update({ where: { id: quote.id }, data: { currentVersionId: version.id } });
    const storageObject = await prisma.storageObject.create({ data: { storageKey: `private-files/notification-fanout/${suffix}.pdf`, contentType: 'application/pdf', byteSize: 2048n, sha256: 'a'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
    const generatedDocument = await prisma.generatedDocument.create({ data: { quoteId: quote.id, quoteVersionId: version.id, storageObjectId: storageObject.id, templateVersion: 'quote-pdf-v1', status: 'READY', byteSize: 2048n, sha256: 'a'.repeat(64), generatedAt: now, readyAt: now } });
    const acceptance = await prisma.quoteAcceptance.create({ data: { quoteId: quote.id, quoteVersionId: version.id, generatedDocumentId: generatedDocument.id, acceptedById: customer.id, documentSha256: 'a'.repeat(64), signerName: 'Fanout customer', termsVersion: 'quote-terms-2026-01', idempotencyKeyHash: 'b'.repeat(64) } });
    const workingVersion = await prisma.quoteVersion.create({ data: { quoteId: quote.id, versionNumber: 2, status: 'BORRADOR', currencyCode: 'MXN', subtotalMinor: 200000n, taxableTotalMinor: 200000n, totalMinor: 200000n, createdById: employee.id } });
    await prisma.quote.update({ where: { id: quote.id }, data: { currentVersionId: workingVersion.id } });
    const fileStorage = await prisma.storageObject.create({ data: { storageKey: `private-files/notification-fanout/${suffix}.jpg`, contentType: 'image/jpeg', byteSize: 1024n, sha256: 'c'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
    const file = await prisma.fileAttachment.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId, storageObjectId: fileStorage.id, originalFileName: 'avance.jpg', category: 'REFERENCE_IMAGE', visibility: 'CUSTOMER', status: 'AVAILABLE', uploadedById: employee.id } });
    let informationMessageId: string | null = null;
    let projectId: string | null = null;
    let projectOwnerId: string | null = null;
    const [assignmentEvent, quoteSentEvent, acceptedEvent, messageEvent, fileEvent, internalEvent] = await Promise.all([
      prisma.outboxEvent.create({ data: { eventType: 'REQUEST.ASSIGNED', aggregateType: 'QUOTE_REQUEST', aggregateId: request.quoteRequestId, payload: { quoteRequestId: request.quoteRequestId, folio: request.folio, assignedToId: employee.id } } }),
      prisma.outboxEvent.create({ data: { eventType: 'QUOTE.VERSION_STATUS_CHANGED', aggregateType: 'QUOTE', aggregateId: quote.id, payload: { quoteId: quote.id, quoteVersionId: version.id, quoteRequestId: request.quoteRequestId, folio: request.folio, fromStatus: 'EN_REVISION', toStatus: 'ENVIADA' } } }),
      prisma.outboxEvent.create({ data: { eventType: 'QUOTE.ACCEPTED', aggregateType: 'QUOTE', aggregateId: quote.id, payload: { quoteId: quote.id, quoteVersionId: version.id, quoteRequestId: request.quoteRequestId, folio: request.folio, versionNumber: 1, acceptanceId: acceptance.id, generatedDocumentId: generatedDocument.id, termsVersion: 'quote-terms-2026-01' } } }),
      prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: conversation.id, payload: { conversationId: conversation.id, quoteRequestId: request.quoteRequestId, clientId: request.clientId, messageId: message.id, visibility: 'CUSTOMER', folio: request.folio } } }),
      prisma.outboxEvent.create({ data: { eventType: 'FILE.AVAILABLE', aggregateType: 'FILE_ATTACHMENT', aggregateId: file.id, payload: { fileId: file.id, quoteRequestId: request.quoteRequestId, visibility: 'CUSTOMER', category: 'REFERENCE_IMAGE' } } }),
      prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: conversation.id, payload: { conversationId: conversation.id, quoteRequestId: request.quoteRequestId, clientId: request.clientId, messageId: internalMessage.id, visibility: 'INTERNAL', folio: request.folio } } }),
    ]);
    const receivedEvent = await prisma.outboxEvent.findFirstOrThrow({ where: { id: { not: assignmentEvent.id }, aggregateId: request.quoteRequestId, eventType: 'REQUEST.RECEIVED' } });
    const eventIds = [receivedEvent.id, assignmentEvent.id, quoteSentEvent.id, acceptedEvent.id, messageEvent.id, fileEvent.id, internalEvent.id];
    await prisma.outboxEvent.updateMany({ where: { id: { in: eventIds } }, data: { availableAt: workerNow } });

    try {
      await expect(resolveNotificationEvent(prisma, {
        eventType: 'MESSAGE.CREATED',
        aggregateType: 'CONVERSATION',
        aggregateId: conversation.id,
        payload: { conversationId: conversation.id, quoteRequestId: request.quoteRequestId, clientId: request.clientId, messageId: message.id, visibility: 'CUSTOMER', folio: request.folio },
      }, {
        ...DEFAULT_COMMERCIAL_V2_FLAGS,
        commercialWorkspaceV2: true,
        requestWorkspaceV2: true,
      })).resolves.toMatchObject({ kind: 'CANCELLED', reason: 'INBOX_DIGEST' });

      const result = await processNotificationFanoutBatch({ prisma, now: workerNow, batchSize: 50, leaseSeconds: 60 });
      // UX audit fix: QUOTE.ACCEPTED now also reaches the customer (an acceptance confirmation
      // that never existed before) -- one extra materialized/pending delivery from the same
      // claimed outbox event, since resolving one event into two recipients doesn't change how
      // many outbox events were claimed.
      // Gerencia también recibe la solicitud del sitio y la aceptación: cuántos gestores hay depende de la base.
      expect(result).toMatchObject({ claimed: 7, cancelled: 2 });
      expect(result.materialized).toBeGreaterThanOrEqual(6);

      const deliveries = await prisma.notificationDelivery.findMany({ where: { outboxEventId: { in: eventIds } }, orderBy: { createdAt: 'asc' } });
      expect(deliveries.filter((delivery) => delivery.status === 'PENDING').length).toBeGreaterThanOrEqual(6);
      expect(deliveries.find((delivery) => delivery.outboxEventId === assignmentEvent.id)?.recipientUserId).toBe(employee.id);
      expect(deliveries.find((delivery) => delivery.outboxEventId === messageEvent.id)).toMatchObject({ status: 'CANCELLED', cancelReason: 'INBOX_DIGEST' });
      expect(deliveries.find((delivery) => delivery.outboxEventId === receivedEvent.id)?.payload).toMatchObject({ folio: request.folio, actionPath: '/portal/access', actionLabel: 'Solicitar acceso' });
      expect(deliveries.find((delivery) => delivery.outboxEventId === quoteSentEvent.id)?.payload).toMatchObject({ folio: request.folio, actionPath: '/portal/access', actionLabel: 'Solicitar acceso' });
      const acceptedDeliveries = deliveries.filter((delivery) => delivery.outboxEventId === acceptedEvent.id);
      expect(acceptedDeliveries.length).toBeGreaterThanOrEqual(2);
      expect(acceptedDeliveries.find((delivery) => delivery.recipientUserId === employee.id)?.payload).toMatchObject({ totalLabel: '1,250.00 MXN', actionPath: `/staff/requests?request=${request.quoteRequestId}` });
      expect(acceptedDeliveries.find((delivery) => delivery.recipientUserId === null)?.payload).toMatchObject({ totalLabel: '1,250.00 MXN', folio: request.folio, actionPath: '/portal/access', actionLabel: 'Solicitar acceso' });
      expect(deliveries.find((delivery) => delivery.outboxEventId === fileEvent.id)?.payload).toMatchObject({ fileName: 'avance.jpg', actionPath: '/portal/access', actionLabel: 'Solicitar acceso' });
      expect(deliveries.find((delivery) => delivery.outboxEventId === internalEvent.id)).toMatchObject({ status: 'CANCELLED', cancelReason: 'INTERNAL_VISIBILITY', recipientAddressCiphertext: null });
      expect(await prisma.outboxEvent.count({ where: { id: { in: eventIds }, status: 'SENT' } })).toBe(7);
      expect(await processNotificationFanoutBatch({ prisma, now: new Date(workerNow.getTime() + 1_000), batchSize: 50, leaseSeconds: 60 })).toMatchObject({ claimed: 0 });

      await prisma.clientContact.update({ where: { id: request.contactId }, data: { userId: customer.id } });
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'INFORMACION_REQUERIDA' } });
      const informationMessage = await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderUserId: employee.id, visibility: 'CUSTOMER', body: 'Comparte las medidas para continuar.' } });
      informationMessageId = informationMessage.id;
      const informationEvent = { eventType: 'REQUEST.STATUS_CHANGED', aggregateType: 'QUOTE_REQUEST', aggregateId: request.quoteRequestId, payload: { quoteRequestId: request.quoteRequestId, folio: request.folio, fromStatus: 'EN_REVISION', toStatus: 'INFORMACION_REQUERIDA', source: 'request_information', messageId: informationMessage.id } };
      const informationResolution = await resolveNotificationEvent(prisma, informationEvent);
      expect(informationResolution).toMatchObject({ kind: 'RECIPIENTS', contexts: [{ recipient: { userId: customer.id }, messagePreview: informationMessage.body }] });
      if (informationResolution.kind !== 'RECIPIENTS') throw new Error('Expected the active portal contact to receive the information request.');
      expect(mapNotificationEvent(informationEvent, informationResolution.contexts[0])).toMatchObject({ kind: 'INTENT', templateKey: 'request.information_needed' });

      await prisma.quoteVersion.update({ where: { id: workingVersion.id }, data: { status: 'RECHAZADA' } });
      const declinedEvent = { eventType: 'QUOTE.DECLINED', aggregateType: 'QUOTE_REQUEST', aggregateId: request.quoteRequestId, payload: { quoteId: quote.id, quoteVersionId: workingVersion.id, quoteRequestId: request.quoteRequestId, folio: request.folio, versionNumber: 2, reason: 'PRICE' } };
      const declinedResolution = await resolveNotificationEvent(prisma, declinedEvent);
      expect(declinedResolution).toMatchObject({ kind: 'RECIPIENTS', contexts: [{ recipient: { userId: employee.id }, actionPath: `/staff/requests?request=${request.quoteRequestId}` }] });
      if (declinedResolution.kind !== 'RECIPIENTS') throw new Error('Expected the current request owner to receive the declined quote email.');
      expect(mapNotificationEvent(declinedEvent, declinedResolution.contexts[0])).toMatchObject({ kind: 'INTENT', templateKey: 'quote.declined' });

      await prisma.quoteVersion.update({ where: { id: workingVersion.id }, data: { status: 'ENVIADA', validUntil: new Date(Date.now() + (36 * 60 * 60 * 1000)) } });
      await prisma.quote.update({ where: { id: quote.id }, data: { publishedVersionId: workingVersion.id } });
      const expiringEvent = { eventType: 'QUOTE.EXPIRING', aggregateType: 'QUOTE', aggregateId: quote.id, payload: { quoteId: quote.id, quoteVersionId: workingVersion.id, quoteRequestId: request.quoteRequestId, folio: request.folio, versionNumber: 2, expiresInHours: 24 } };
      const expiringResolution = await resolveNotificationEvent(prisma, expiringEvent);
      expect(expiringResolution).toMatchObject({ kind: 'RECIPIENTS', contexts: [{ recipient: { userId: customer.id }, versionNumber: 2, expiresInHours: 24 }] });
      if (expiringResolution.kind !== 'RECIPIENTS') throw new Error('Expected the active portal contact to receive the quote expiration notice.');
      expect(mapNotificationEvent(expiringEvent, expiringResolution.contexts[0])).toMatchObject({ kind: 'INTENT', templateKey: 'quote.expiring' });

      const projectFolio = `OCP-2026-${suffix.slice(-6).padStart(6, '0')}`;
      const project = await prisma.project.create({ data: { folio: projectFolio, quoteAcceptanceId: acceptance.id, quoteRequestId: request.quoteRequestId, clientId: request.clientId, contactId: request.contactId, ownerId: employee.id, createdById: employee.id } });
      projectId = project.id;
      const projectCreatedEvent = { eventType: 'PROJECT.CREATED', aggregateType: 'PROJECT', aggregateId: project.id, payload: { projectId: project.id, folio: project.folio, quoteRequestId: request.quoteRequestId, source: 'customer_acceptance', ownerId: employee.id, createdById: employee.id } };
      const projectCreatedResolution = await resolveNotificationEvent(prisma, projectCreatedEvent);
      expect(projectCreatedResolution).toMatchObject({ kind: 'RECIPIENTS', contexts: [{ recipient: { userId: customer.id }, projectFolio: project.folio, folio: request.folio }] });
      if (projectCreatedResolution.kind !== 'RECIPIENTS') throw new Error('Expected the active portal contact to receive the project notice.');
      expect(mapNotificationEvent(projectCreatedEvent, projectCreatedResolution.contexts[0])).toMatchObject({ kind: 'INTENT', templateKey: 'project.started' });

      const projectOwner = await prisma.user.create({ data: { email: `fanout-owner-${suffix}@example.test`, emailNormalized: `fanout-owner-${suffix}@example.test`, displayName: 'New project owner', type: 'EMPLOYEE', status: 'ACTIVE' } });
      projectOwnerId = projectOwner.id;
      await prisma.project.update({ where: { id: project.id }, data: { ownerId: projectOwner.id } });
      const ownerChangedEvent = { eventType: 'PROJECT.OWNER_CHANGED', aggregateType: 'PROJECT', aggregateId: project.id, payload: { projectId: project.id, ownerId: projectOwner.id, assignedById: employee.id } };
      const ownerChangedResolution = await resolveNotificationEvent(prisma, ownerChangedEvent);
      expect(ownerChangedResolution).toMatchObject({ kind: 'RECIPIENTS', contexts: [{ recipient: { userId: projectOwner.id }, projectFolio: project.folio }] });
      if (ownerChangedResolution.kind !== 'RECIPIENTS') throw new Error('Expected the new project owner to receive the assignment email.');
      expect(mapNotificationEvent(ownerChangedEvent, ownerChangedResolution.contexts[0])).toMatchObject({ kind: 'INTENT', templateKey: 'project.assigned' });
      await prisma.project.update({ where: { id: project.id }, data: { ownerId: employee.id } });
      await expect(resolveNotificationEvent(prisma, ownerChangedEvent)).resolves.toMatchObject({ kind: 'CANCELLED', reason: 'INVALID_PAYLOAD' });
    } finally {
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: { in: eventIds } } });
      await prisma.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
      if (projectId) await prisma.project.delete({ where: { id: projectId } });
      await prisma.quoteAcceptance.deleteMany({ where: { id: acceptance.id } });
      await prisma.generatedDocument.delete({ where: { id: generatedDocument.id } });
      await prisma.fileAttachment.delete({ where: { id: file.id } });
      await prisma.storageObject.deleteMany({ where: { id: { in: [storageObject.id, fileStorage.id] } } });
      await prisma.conversationMessage.delete({ where: { id: internalMessage.id } });
      await prisma.conversationMessage.delete({ where: { id: message.id } });
      if (informationMessageId) await prisma.conversationMessage.delete({ where: { id: informationMessageId } });
      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.quoteVersion.delete({ where: { id: version.id } });
      await prisma.quoteVersion.delete({ where: { id: workingVersion.id } });
      await prisma.quote.delete({ where: { id: quote.id } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: request.quoteRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: request.quoteRequestId } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.user.deleteMany({ where: { id: { in: [customer.id, employee.id, ...(projectOwnerId ? [projectOwnerId] : [])] } } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  }, 45_000);

  it('skips immediate mail for a portal contact and keeps it for a contact without an account', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const workerNow = new Date('2000-01-01T12:00:00.000Z');
    const fixtureNow = new Date();
    const request = await createQuoteRequest({
      idempotencyKey: `notification-message-routing-${suffix}`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: `Routing contact ${suffix}`, email: `routing-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'Message email routing fixture', consentAt: fixtureNow },
    }, { prisma, now: fixtureNow });
    const employee = await prisma.user.create({ data: { email: `routing-staff-${suffix}@example.test`, emailNormalized: `routing-staff-${suffix}@example.test`, displayName: 'Routing staff', type: 'EMPLOYEE', status: 'ACTIVE' } });
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { currentAssigneeId: employee.id } });
    const conversation = await prisma.conversation.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } });
    const guestMessage = await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderUserId: employee.id, visibility: 'CUSTOMER', body: 'Actualización para un contacto sin cuenta.' } });
    const guestEvent = await prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: conversation.id, availableAt: workerNow, payload: { conversationId: conversation.id, quoteRequestId: request.quoteRequestId, clientId: request.clientId, messageId: guestMessage.id, visibility: 'CUSTOMER', folio: request.folio } } });
    let customer: { id: string } | null = null;
    let portalMessage: { id: string } | null = null;
    let portalEvent: typeof guestEvent | null = null;

    try {
      const guestLease = new Date(workerNow.getTime() + 60_000);
      const guestProcessing = await prisma.outboxEvent.update({ where: { id: guestEvent.id }, data: { status: 'PROCESSING', attempts: { increment: 1 }, availableAt: guestLease } });
      await expect(fanOutNotificationEvent(prisma, { id: guestEvent.id, eventType: guestEvent.eventType, aggregateType: guestEvent.aggregateType, aggregateId: guestEvent.aggregateId, payload: guestEvent.payload as Record<string, unknown>, attempts: guestProcessing.attempts, availableAt: guestLease, createdAt: guestProcessing.createdAt }, guestLease, workerNow)).resolves.toMatchObject({ materialized: 1, cancelled: false });
      await expect(prisma.notificationDelivery.findFirstOrThrow({ where: { outboxEventId: guestEvent.id } })).resolves.toMatchObject({ status: 'PENDING', templateKey: 'message.created', recipientUserId: null });

      customer = await prisma.user.create({ data: { email: `routing-${suffix}@example.test`, emailNormalized: `routing-${suffix}@example.test`, displayName: 'Routing portal customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
      await prisma.clientContact.update({ where: { id: request.contactId }, data: { userId: customer.id } });
      portalMessage = await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderUserId: employee.id, visibility: 'CUSTOMER', body: 'Actualización para un contacto con cuenta.' } });
      portalEvent = await prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: conversation.id, availableAt: new Date(workerNow.getTime() + 1_000), payload: { conversationId: conversation.id, quoteRequestId: request.quoteRequestId, clientId: request.clientId, messageId: portalMessage.id, visibility: 'CUSTOMER', folio: request.folio } } });
      const portalNow = new Date(workerNow.getTime() + 1_000);
      const portalLease = new Date(portalNow.getTime() + 60_000);
      const portalProcessing = await prisma.outboxEvent.update({ where: { id: portalEvent.id }, data: { status: 'PROCESSING', attempts: { increment: 1 }, availableAt: portalLease } });
      await expect(fanOutNotificationEvent(prisma, { id: portalEvent.id, eventType: portalEvent.eventType, aggregateType: portalEvent.aggregateType, aggregateId: portalEvent.aggregateId, payload: portalEvent.payload as Record<string, unknown>, attempts: portalProcessing.attempts, availableAt: portalLease, createdAt: portalProcessing.createdAt }, portalLease, portalNow)).resolves.toMatchObject({ materialized: 0, cancelled: true });
      await expect(prisma.notificationDelivery.findFirstOrThrow({ where: { outboxEventId: portalEvent.id } })).resolves.toMatchObject({ status: 'CANCELLED', cancelReason: 'INBOX_DIGEST', templateKey: 'system.cancelled' });
    } finally {
      const eventIds = [guestEvent.id, ...(portalEvent ? [portalEvent.id] : [])];
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: { in: eventIds } } });
      await prisma.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
      if (portalMessage) await prisma.conversationMessage.delete({ where: { id: portalMessage.id } });
      await prisma.conversationMessage.delete({ where: { id: guestMessage.id } });
      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: request.quoteRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: request.quoteRequestId } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.user.deleteMany({ where: { id: { in: [employee.id, ...(customer ? [customer.id] : [])] } } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  }, 30_000);

  it('materializes auth delivery without copying the raw token to safe payload', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const workerNow = new Date('2000-01-01T12:00:00.000Z');
    const rawToken = `raw-auth-token-${suffix}-never-persisted`;
    const client = await prisma.client.create({ data: { displayName: `Auth client ${suffix}` } });
    const user = await prisma.user.create({ data: { email: `fanout-auth-${suffix}@example.test`, emailNormalized: `fanout-auth-${suffix}@example.test`, displayName: 'Auth recipient', type: 'CUSTOMER', status: 'ACTIVE', clientId: client.id } });
    const token = await prisma.authToken.create({ data: { userId: user.id, type: 'MAGIC_LINK', tokenHash: fingerprintToken(rawToken), expiresAt: new Date('2030-01-01T00:00:00.000Z') } });
    const event = await prisma.outboxEvent.create({ data: { eventType: 'AUTH.CUSTOMER_MAGIC_LINK', aggregateType: 'USER', aggregateId: user.id, availableAt: workerNow, payload: { tokenId: token.id, tokenCiphertext: encryptSecret(rawToken, readServerEnv().AUTH_DELIVERY_ENCRYPTION_KEY), tokenType: 'MAGIC_LINK' } } });

    try {
      await expect(processNotificationFanoutBatch({ prisma, now: workerNow, batchSize: 10, leaseSeconds: 60 })).resolves.toMatchObject({ claimed: 1, materialized: 1 });
      const delivery = await prisma.notificationDelivery.findFirstOrThrow({ where: { outboxEventId: event.id } });
      expect(JSON.stringify(delivery.payload)).not.toContain(rawToken);
      await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { availableAt: workerNow } });
      let deliveredText = '';
      const provider: EmailProvider = { async send(message) { deliveredText = message.text; return { providerMessageId: 'auth-mailpit-fixture' }; } };
      await expect(processNotificationBatch({ prisma, provider, now: new Date(workerNow.getTime() + 1_000), batchSize: 10, leaseSeconds: 60, maxAttempts: 3 })).resolves.toMatchObject({ claimed: 1, sent: 1 });
      expect(deliveredText).toContain(rawToken);
    } finally {
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: event.id } });
      await prisma.outboxEvent.delete({ where: { id: event.id } });
      await prisma.authToken.delete({ where: { id: token.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.client.delete({ where: { id: client.id } });
    }
  }, 30_000);
});
