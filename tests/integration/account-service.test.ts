import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/server/auth/crypto';
import { generateTotpCode, protectMfaSecret } from '@/server/auth/mfa';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import { createSession, getActorFromSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import {
  changeAccountPassword,
  confirmAccountMfaEnrollment,
  disableAccountMfa,
  getAccountOverview,
  revokeAccountSession,
  revokeOtherAccountSessions,
  startAccountMfaEnrollment,
  updateAccountProfile,
} from '@/server/modules/account/service';
import { resetTeamMemberMfa } from '@/server/modules/team/service';

const context = { ipAddress: null, userAgent: 'account-service-test' };

function employee(userId: string, roles: string[]): Actor {
  return { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(roles), mfaVerified: true };
}

describe('account self-service', () => {
  it('lets an employee rename, change password, enable and disable two-step verification and manage sessions', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const prisma = getPrisma();
    const stamp = Date.now().toString();
    const now = new Date();
    const originalPassword = `Original-${stamp}-password1`;
    const [salesRole, managerRole, adminRole] = await Promise.all(['sales', 'manager', 'admin'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    const user = await prisma.user.create({ data: { email: `account-${stamp}@example.test`, emailNormalized: `account-${stamp}@example.test`, displayName: `Cuenta ${stamp}`, type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(originalPassword), roles: { create: { roleId: salesRole.id } } } });
    const manager = await prisma.user.create({ data: { email: `account-manager-${stamp}@example.test`, emailNormalized: `account-manager-${stamp}@example.test`, displayName: `Gerencia ${stamp}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } });
    const admin = await prisma.user.create({ data: { email: `account-admin-${stamp}@example.test`, emailNormalized: `account-admin-${stamp}@example.test`, displayName: `Admin ${stamp}`, type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(originalPassword), mfaRequired: true, mfaEnrolledAt: now, mfaSecretCiphertext: protectMfaSecret('JBSWY3DPEHPK3PXP', readServerEnv().MFA_ENCRYPTION_KEY), roles: { create: { roleId: adminRole.id } } } });
    const actor = employee(user.id, ['sales']);
    const current = await createSession({ userId: user.id, ipAddress: null, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', mfaVerified: false }, { prisma, now });
    const other = await createSession({ userId: user.id, ipAddress: '10.9.0.1', userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1', mfaVerified: false }, { prisma, now });

    try {
      const overview = await getAccountOverview(actor, current.sessionId, { prisma, now });
      expect(overview.profile).toMatchObject({ displayName: `Cuenta ${stamp}`, roleLabel: 'Ventas' });
      expect(overview.security).toEqual({ mfaEnabled: false, mfaEnrolledAt: null, mfaMandatory: false });
      expect(overview.sessions.map((session) => session.current).sort()).toEqual([false, true]);

      expect(await updateAccountProfile(actor, { displayName: '  Ana   López Rivera ' }, { prisma, now })).toEqual({ displayName: 'Ana López Rivera' });
      await expect(updateAccountProfile(actor, { displayName: 'A' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      // Contraseña: exige la actual; al cambiarla, las otras sesiones se cierran y la actual sigue.
      await expect(changeAccountPassword(actor, current.sessionId, { currentPassword: 'no-es-la-actual-1', newPassword: `Nueva-${stamp}-password2` }, context, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await changeAccountPassword(actor, current.sessionId, { currentPassword: originalPassword, newPassword: `Nueva-${stamp}-password2` }, context, { prisma, now })).toEqual({ otherSessionsRevoked: 1 });
      expect(await getActorFromSession(other.rawToken, { prisma, now })).toBeNull();
      expect(await getActorFromSession(current.rawToken, { prisma, now })).not.toBeNull();
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
      expect(await verifyPassword(stored.passwordHash!, `Nueva-${stamp}-password2`)).toBe(true);
      expect(await prisma.authEvent.count({ where: { userId: user.id, eventType: 'PASSWORD_CHANGED' } })).toBe(1);

      // Verificación en dos pasos: nada se guarda hasta confirmar un código válido.
      const enrollment = await startAccountMfaEnrollment(actor, { prisma, now });
      expect(enrollment.uri).toMatch(/^otpauth:\/\/totp\//u);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaSecretCiphertext: true } })).toEqual({ mfaSecretCiphertext: null });
      await expect(confirmAccountMfaEnrollment(employee(manager.id, ['manager']), current.sessionId, { enrollmentToken: enrollment.enrollmentToken, code: generateTotpCode(enrollment.secret, now.getTime()) }, context, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(confirmAccountMfaEnrollment(actor, current.sessionId, { enrollmentToken: enrollment.enrollmentToken, code: '000000' === generateTotpCode(enrollment.secret, now.getTime()) ? '111111' : '000000' }, context, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      const laterSession = await createSession({ userId: user.id, ipAddress: null, userAgent: 'otro equipo', mfaVerified: false }, { prisma, now });
      expect(await confirmAccountMfaEnrollment(actor, current.sessionId, { enrollmentToken: enrollment.enrollmentToken, code: generateTotpCode(enrollment.secret, now.getTime()) }, context, { prisma, now })).toMatchObject({ enabled: true, otherSessionsRevoked: 1 });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaRequired: true, mfaEnrolledAt: true } })).toMatchObject({ mfaRequired: true, mfaEnrolledAt: now });
      // La sesión con la que se activó sigue viva (quedó verificada); una sesión sin código ya no sirve.
      expect(await getActorFromSession(current.rawToken, { prisma, now })).not.toBeNull();
      expect(await getActorFromSession(laterSession.rawToken, { prisma, now })).toBeNull();
      const unverified = await createSession({ userId: user.id, ipAddress: null, userAgent: 'sin código', mfaVerified: false }, { prisma, now });
      expect(await getActorFromSession(unverified.rawToken, { prisma, now })).toBeNull();
      await expect(startAccountMfaEnrollment(actor, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT' });

      // Desactivar: contraseña y un código nuevo (el mismo código no se acepta dos veces).
      const later = new Date(now.getTime() + 31_000);
      await expect(disableAccountMfa(actor, { currentPassword: 'no-es-la-actual-1', code: generateTotpCode(enrollment.secret, later.getTime()) }, context, { prisma, now: later })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await disableAccountMfa(actor, { currentPassword: `Nueva-${stamp}-password2`, code: generateTotpCode(enrollment.secret, later.getTime()) }, context, { prisma, now: later })).toEqual({ enabled: false });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaRequired: true, mfaSecretCiphertext: true } })).toEqual({ mfaRequired: false, mfaSecretCiphertext: null });
      // Para administradores es obligatoria.
      await expect(disableAccountMfa(employee(admin.id, ['admin']), { currentPassword: originalPassword, code: '123456' }, context, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // Sesiones: cerrar otra, no la actual; y cerrar todas las demás.
      const phone = await createSession({ userId: user.id, ipAddress: null, userAgent: 'teléfono', mfaVerified: false }, { prisma, now });
      await expect(revokeAccountSession(actor, current.sessionId, current.sessionId, context, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await revokeAccountSession(actor, current.sessionId, phone.sessionId, context, { prisma, now })).toEqual({ revoked: 1 });
      await expect(revokeAccountSession(actor, current.sessionId, phone.sessionId, context, { prisma, now })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await createSession({ userId: user.id, ipAddress: null, userAgent: 'tableta', mfaVerified: false }, { prisma, now });
      expect(await revokeOtherAccountSessions(actor, current.sessionId, context, { prisma, now })).toEqual({ revoked: 2 });

      // Recuperación desde Equipo: gerencia quita la verificación de quien perdió su teléfono.
      await prisma.user.update({ where: { id: user.id }, data: { mfaRequired: true, mfaEnrolledAt: now, mfaSecretCiphertext: protectMfaSecret('JBSWY3DPEHPK3PXP', readServerEnv().MFA_ENCRYPTION_KEY) } });
      expect(await resetTeamMemberMfa(employee(manager.id, ['manager']), user.id, context, { prisma, now })).toEqual({ id: user.id, mfaEnabled: false });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaRequired: true, mfaSecretCiphertext: true } })).toEqual({ mfaRequired: false, mfaSecretCiphertext: null });
      await expect(resetTeamMemberMfa(employee(manager.id, ['manager']), admin.id, context, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await prisma.auditLog.count({ where: { entityId: user.id, action: 'team.mfa_reset' } })).toBe(1);
    } finally {
      const userIds = [user.id, manager.id, admin.id];
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: userIds } }, { actorUserId: { in: userIds } }] } });
      await prisma.authToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }, 60_000);
});
