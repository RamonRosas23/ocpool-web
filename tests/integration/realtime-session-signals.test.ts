import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import { logout } from '@/server/auth/service';
import { createSession, revokeSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { revokeAccountSession, revokeOtherAccountSessions } from '@/server/modules/account/service';
import { revokeTeamMemberSessions, suspendTeamMember } from '@/server/modules/team/service';

type Signal = { t: string; u: string; sid?: string; keep?: string };

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the signal.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('realtime signals when sessions close', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const context = { ipAddress: '127.0.0.1', userAgent: 'realtime-session-signals' };
  const received: Signal[] = [];
  let listener: pg.Client | null = null;
  let managerId = '';
  let memberId = '';

  const actorFor = (userId: string, role: 'manager' | 'sales'): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles([role]), mfaVerified: true });
  const openSession = async (userId: string, key: string) => {
    const token = `rt-session-${key}-${suffix}-abcdefghijklmnopqrstuvwxyz-0123456789`;
    const { sessionId } = await createSession({ userId, ipAddress: null, userAgent: 'realtime-session-signals' }, { prisma, tokenGenerator: () => token });
    return { token, sessionId };
  };
  const closing = () => received.filter((signal) => signal.t === 's' && signal.u === memberId);
  const closingAll = () => closing().filter((signal) => !signal.sid && !signal.keep).length;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    listener = new pg.Client({ connectionString: readServerEnv().DATABASE_URL });
    await listener.connect();
    await listener.query('LISTEN ocpool_realtime');
    listener.on('notification', (message) => {
      if (message.payload) received.push(JSON.parse(message.payload) as Signal);
    });
    const [salesRole, managerRole] = await Promise.all([prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }), prisma.role.findUniqueOrThrow({ where: { key: 'manager' } })]);
    managerId = (await prisma.user.create({ data: { email: `rt-session-manager-${suffix}@example.test`, emailNormalized: `rt-session-manager-${suffix}@example.test`, displayName: 'RT Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } })).id;
    memberId = (await prisma.user.create({ data: { email: `rt-session-member-${suffix}@example.test`, emailNormalized: `rt-session-member-${suffix}@example.test`, displayName: 'RT Member', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
  });

  afterAll(async () => {
    await listener?.end();
    const userIds = [managerId, memberId].filter(Boolean);
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it('closes just the revoked session, or every session but the current one', async () => {
    const current = await openSession(memberId, 'current');
    const other = await openSession(memberId, 'other');
    await openSession(memberId, 'third');
    const member = actorFor(memberId, 'sales');
    await revokeAccountSession(member, current.sessionId, other.sessionId, context, { prisma });
    await waitFor(() => closing().some((signal) => signal.sid === other.sessionId && !signal.keep));
    await revokeOtherAccountSessions(member, current.sessionId, context, { prisma });
    await waitFor(() => closing().some((signal) => signal.keep === current.sessionId && !signal.sid));
  });

  it('closes the current session on logout and on a direct revocation', async () => {
    const loggedOut = await openSession(memberId, 'logout');
    await logout(loggedOut.token, context, { prisma });
    await waitFor(() => closing().some((signal) => signal.sid === loggedOut.sessionId));
    const revoked = await openSession(memberId, 'revoked');
    await revokeSession(revoked.sessionId, 'test', { prisma });
    await waitFor(() => closing().some((signal) => signal.sid === revoked.sessionId));
    // Revocar una sesión ya cerrada no vuelve a avisar.
    const before = closing().length;
    await revokeSession(revoked.sessionId, 'test', { prisma });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(closing()).toHaveLength(before);
  });

  it('closes every session when a manager revokes them or suspends the person', async () => {
    const manager = actorFor(managerId, 'manager');
    await openSession(memberId, 'team');
    const before = closingAll();
    await revokeTeamMemberSessions(manager, memberId, { prisma });
    await waitFor(() => closingAll() === before + 1);
    await suspendTeamMember(manager, memberId, {}, { prisma });
    await waitFor(() => closingAll() === before + 2);
  });
});
