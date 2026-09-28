import { describe, expect, it } from 'vitest';
import { decryptSecret } from '@/server/auth/crypto';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import { consumePasswordRecovery } from '@/server/auth/service';
import { createSession, getActorFromSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import {
  cancelTeamInvitation,
  changeTeamMemberRole,
  inviteTeamMember,
  listTeamMembers,
  reactivateTeamMember,
  revokeTeamMemberSessions,
  sendTeamMemberPasswordReset,
  suspendTeamMember,
} from '@/server/modules/team/service';

const context = { ipAddress: null, userAgent: 'team-service-test' };

function employee(userId: string, roles: string[]): Actor {
  return { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(roles), mfaVerified: true };
}

describe('team administration service', () => {
  it('invites, activates, changes roles, suspends with reassignment and reactivates team members with guardrails', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const prisma = getPrisma();
    const stamp = Date.now().toString();
    const now = new Date();
    const [managerRole, salesRole, adminRole] = await Promise.all(['manager', 'sales', 'admin'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    const managerUser = await prisma.user.create({ data: { email: `team-manager-${stamp}@example.test`, emailNormalized: `team-manager-${stamp}@example.test`, displayName: `Gerente ${stamp}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } });
    const heirUser = await prisma.user.create({ data: { email: `team-heir-${stamp}@example.test`, emailNormalized: `team-heir-${stamp}@example.test`, displayName: `Relevo ${stamp}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } });
    const adminUser = await prisma.user.create({ data: { email: `team-admin-${stamp}@example.test`, emailNormalized: `team-admin-${stamp}@example.test`, displayName: `Admin ${stamp}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: adminRole.id } } } });
    const request = await createQuoteRequest({
      idempotencyKey: `team-service-${stamp}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Cliente equipo ${stamp}`, email: `team-client-${stamp}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Team service fixture', consentAt: now },
    }, { prisma, now });
    const closedRequest = await createQuoteRequest({
      idempotencyKey: `team-service-closed-${stamp}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Cliente cerrado ${stamp}`, email: `team-client-closed-${stamp}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Team service closed fixture', consentAt: now },
    }, { prisma, now });
    const customerUser = await prisma.user.create({ data: { email: `team-client-${stamp}@example.test`, emailNormalized: `team-client-${stamp}@example.test`, displayName: 'Cliente portal', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
    const manager = employee(managerUser.id, ['manager']);
    const sales = employee(heirUser.id, ['sales']);
    const createdIds: string[] = [];
    const inviteToken = `team-invite-${stamp}-abcdefghijklmnopqrstuvwxyz0123`;

    try {
      // Sólo quien administra el equipo.
      await expect(listTeamMembers(sales, {}, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const invited = await inviteTeamMember(manager, { displayName: '  Nueva   Vendedora ', email: `Team-New-${stamp}@Example.test`, role: 'sales' }, context, { prisma, now, tokenGenerator: () => inviteToken });
      createdIds.push(invited.id);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: invited.id }, select: { status: true, displayName: true, emailNormalized: true, passwordHash: true, roles: { select: { role: { select: { key: true } } } } } });
      expect(stored).toMatchObject({ status: 'INVITED', displayName: 'Nueva Vendedora', emailNormalized: `team-new-${stamp}@example.test`, passwordHash: null });
      expect(stored.roles.map(({ role }) => role.key)).toEqual(['sales']);
      // Invitación de 72 h por correo, cifrada; nunca el enlace en claro.
      const outbox = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: invited.id, eventType: 'AUTH.EMPLOYEE_INVITATION' } });
      expect(outbox.payload).toMatchObject({ tokenType: 'PASSWORD_RESET', expiresInMinutes: 72 * 60, roleLabel: 'Ventas', invitedByName: `Gerente ${stamp}` });
      expect(JSON.stringify(outbox.payload)).not.toContain(inviteToken);
      expect(decryptSecret((outbox.payload as { tokenCiphertext: string }).tokenCiphertext, readServerEnv().AUTH_DELIVERY_ENCRYPTION_KEY)).toBe(inviteToken);
      expect(invited.invitationExpiresAt.getTime() - now.getTime()).toBe(72 * 3_600_000);
      expect(await prisma.auditLog.count({ where: { entityId: invited.id, action: 'team.member_invited' } })).toBe(1);

      await expect(inviteTeamMember(manager, { displayName: 'Otra vez', email: `team-new-${stamp}@example.test`, role: 'sales' }, context, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(inviteTeamMember(manager, { displayName: 'Cliente', email: `team-client-${stamp}@example.test`, role: 'sales' }, context, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('cliente') });

      const pending = await listTeamMembers(manager, { view: 'invited', query: stamp }, { prisma, now });
      expect(pending.items).toEqual([expect.objectContaining({ id: invited.id, state: 'invited', roleLabel: 'Ventas', lock: null })]);
      const everyone = await listTeamMembers(manager, { view: 'all', query: stamp }, { prisma, now });
      expect(everyone.items.find((member) => member.id === managerUser.id)?.lock).toBe('self');
      expect(everyone.items.find((member) => member.id === adminUser.id)?.lock).toBe('admin');

      // Crear la contraseña con el enlace activa la cuenta.
      expect(await consumePasswordRecovery({ rawToken: inviteToken, newPassword: 'ContraseñaSegura123', context }, { prisma, now })).toBe(true);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: invited.id }, select: { status: true } })).toEqual({ status: 'ACTIVE' });

      // Candados: la propia cuenta y las de administrador no se tocan desde Equipo.
      await expect(changeTeamMemberRole(manager, managerUser.id, { role: 'sales' }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(suspendTeamMember(manager, adminUser.id, { reassignToId: null }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(changeTeamMemberRole(manager, invited.id, { role: 'admin' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      expect(await changeTeamMemberRole(manager, invited.id, { role: 'manager' }, { prisma, now })).toMatchObject({ changed: true, roleKey: 'manager' });
      expect((await prisma.userRole.findMany({ where: { userId: invited.id }, select: { role: { select: { key: true } } } })).map(({ role }) => role.key)).toEqual(['manager']);
      expect(await prisma.auditLog.findFirst({ where: { entityId: invited.id, action: 'team.role_changed' }, select: { metadata: true } })).toMatchObject({ metadata: { fromRole: 'Ventas', toRole: 'Gerencia' } });

      // Suspender: sin acceso inmediato y su trabajo abierto pasa a otra persona (lo cerrado no se mueve).
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_REVISION', currentAssigneeId: invited.id } });
      await prisma.requestAssignment.create({ data: { quoteRequestId: request.quoteRequestId, assignedToId: invited.id, assignedById: managerUser.id, assignedAt: now } });
      await prisma.quoteRequest.update({ where: { id: closedRequest.quoteRequestId }, data: { status: 'RECHAZADA', currentAssigneeId: invited.id } });
      const session = await createSession({ userId: invited.id, ipAddress: null, userAgent: 'team-test', mfaVerified: true }, { prisma, now });
      expect(await getActorFromSession(session.rawToken, { prisma, now })).not.toBeNull();
      const busy = await listTeamMembers(manager, { view: 'active', query: stamp }, { prisma, now });
      expect(busy.items.find((member) => member.id === invited.id)).toMatchObject({ openRequests: 1, activeSessions: 1, lastSignInAt: null });

      const suspended = await suspendTeamMember(manager, invited.id, { reassignToId: heirUser.id, reason: 'Dejó la empresa' }, { prisma, now });
      expect(suspended).toMatchObject({ status: 'SUSPENDED', requestsReassigned: 1, sessionsRevoked: 1, reassignedTo: { id: heirUser.id } });
      expect(await getActorFromSession(session.rawToken, { prisma, now })).toBeNull();
      expect(await prisma.quoteRequest.findUniqueOrThrow({ where: { id: request.quoteRequestId }, select: { currentAssigneeId: true } })).toEqual({ currentAssigneeId: heirUser.id });
      expect(await prisma.quoteRequest.findUniqueOrThrow({ where: { id: closedRequest.quoteRequestId }, select: { currentAssigneeId: true } })).toEqual({ currentAssigneeId: invited.id });
      expect(await prisma.requestAssignment.count({ where: { quoteRequestId: request.quoteRequestId, assignedToId: heirUser.id, unassignedAt: null } })).toBe(1);
      expect(await prisma.auditLog.findFirst({ where: { entityId: invited.id, action: 'team.member_suspended' }, select: { metadata: true } })).toMatchObject({ metadata: { reason: 'Dejó la empresa', reassignedTo: `Relevo ${stamp}`, requestsReassigned: 1 } });
      await expect(suspendTeamMember(manager, invited.id, { reassignToId: null }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(sendTeamMemberPasswordReset(manager, invited.id, context, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT' });

      // Reactivar: ya tenía contraseña, así que vuelve activa.
      expect(await reactivateTeamMember(manager, invited.id, context, { prisma, now })).toMatchObject({ status: 'ACTIVE', invitationExpiresAt: null });
      const reset = await sendTeamMemberPasswordReset(manager, invited.id, context, { prisma, now });
      expect(reset.expiresAt.getTime()).toBeGreaterThan(now.getTime());
      expect(await prisma.outboxEvent.count({ where: { aggregateId: invited.id, eventType: 'AUTH.EMPLOYEE_PASSWORD_RESET' } })).toBe(1);
      await createSession({ userId: invited.id, ipAddress: null, userAgent: 'team-test', mfaVerified: true }, { prisma, now });
      expect(await revokeTeamMemberSessions(manager, invited.id, { prisma, now })).toMatchObject({ sessionsRevoked: 1 });

      // Cancelar una invitación y volver a invitar (sin contraseña, reactivar = nueva invitación).
      const second = await inviteTeamMember(manager, { displayName: 'Segunda Persona', email: `team-second-${stamp}@example.test`, role: 'manager' }, context, { prisma, now });
      createdIds.push(second.id);
      expect(await cancelTeamInvitation(manager, second.id, { prisma, now })).toMatchObject({ status: 'DISABLED' });
      expect(await prisma.authToken.count({ where: { userId: second.id, consumedAt: null } })).toBe(0);
      const reinvited = await reactivateTeamMember(manager, second.id, context, { prisma, now });
      expect(reinvited).toMatchObject({ status: 'INVITED' });
      expect(reinvited.invitationExpiresAt).not.toBeNull();
      expect(await prisma.outboxEvent.count({ where: { aggregateId: second.id, eventType: 'AUTH.EMPLOYEE_INVITATION' } })).toBe(2);
    } finally {
      const userIds = [managerUser.id, heirUser.id, adminUser.id, customerUser.id, ...createdIds];
      const requestIds = [request.quoteRequestId, closedRequest.quoteRequestId];
      await prisma.notificationDelivery.deleteMany({ where: { outboxEvent: { aggregateId: { in: [...userIds, ...requestIds] } } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [...userIds, ...requestIds] } } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...userIds, ...requestIds] } }, { actorUserId: { in: userIds } }] } });
      await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.clientContact.deleteMany({ where: { id: { in: [request.contactId, closedRequest.contactId] } } });
      await prisma.authToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.client.deleteMany({ where: { id: { in: [request.clientId, closedRequest.clientId] } } });
    }
  }, 60_000);
});
