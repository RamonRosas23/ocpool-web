import { describe, expect, it } from 'vitest';
import { mapNotificationEvent, renderNotificationTemplate } from '@/server/modules/notifications/templates';
import { isTeamRole, primaryTeamRole, teamMemberLock, teamMemberState, teamViewIncludes } from '@/server/modules/team/domain';

const NOW = new Date('2026-09-27T18:00:00.000Z');

describe('team domain', () => {
  it('only lets Equipo assign sales and manager (admin is bootstrapped with MFA)', () => {
    expect(isTeamRole('sales')).toBe(true);
    expect(isTeamRole('manager')).toBe(true);
    expect(isTeamRole('admin')).toBe(false);
    expect(isTeamRole('customer')).toBe(false);
    expect(primaryTeamRole(['sales', 'admin'])).toBe('admin');
    expect(primaryTeamRole(['sales', 'manager'])).toBe('manager');
    expect(primaryTeamRole([])).toBeNull();
  });

  it('tells a pending invitation from an expired one, and groups states into views', () => {
    expect(teamMemberState({ status: 'ACTIVE', invitationExpiresAt: null }, NOW)).toBe('active');
    expect(teamMemberState({ status: 'INVITED', invitationExpiresAt: '2026-09-28T18:00:00.000Z' }, NOW)).toBe('invited');
    expect(teamMemberState({ status: 'INVITED', invitationExpiresAt: '2026-09-26T18:00:00.000Z' }, NOW)).toBe('invitation_expired');
    expect(teamMemberState({ status: 'INVITED', invitationExpiresAt: null }, NOW)).toBe('invitation_expired');
    expect(teamMemberState({ status: 'DISABLED', invitationExpiresAt: null }, NOW)).toBe('suspended');
    expect(teamViewIncludes('invited', 'invitation_expired')).toBe(true);
    expect(teamViewIncludes('active', 'suspended')).toBe(false);
    expect(teamViewIncludes('all', 'suspended')).toBe(true);
  });

  it('locks your own account and administrator accounts', () => {
    expect(teamMemberLock({ actorUserId: 'a', memberId: 'a', roleKeys: ['manager'] })).toBe('self');
    expect(teamMemberLock({ actorUserId: 'a', memberId: 'b', roleKeys: ['admin'] })).toBe('admin');
    expect(teamMemberLock({ actorUserId: 'a', memberId: 'b', roleKeys: ['sales'] })).toBeNull();
  });
});

describe('team invitation email', () => {
  const recipient = { userId: '00000000-0000-4000-8000-000000000001', email: 'nueva@example.test', displayName: 'Nueva Persona', audience: 'STAFF' as const };
  const payload = { tokenId: '00000000-0000-4000-8000-000000000002', tokenCiphertext: 'v1.secret-material', tokenType: 'PASSWORD_RESET', expiresInMinutes: 4320, invitedByName: 'Ana Gerente', roleLabel: 'Ventas' };

  it('maps only to staff, keeps the token out of the safe payload and carries who invites and the role', () => {
    const result = mapNotificationEvent({ eventType: 'AUTH.EMPLOYEE_INVITATION', aggregateType: 'USER', aggregateId: recipient.userId, payload }, { recipient });
    expect(result.kind).toBe('INTENT');
    if (result.kind !== 'INTENT') throw new Error('Expected notification intent.');
    expect(result.templateKey).toBe('auth.employee.invitation');
    expect(result.safePayload).toMatchObject({ expiresMinutes: 4320, senderName: 'Ana Gerente', roleLabel: 'Ventas' });
    expect(JSON.stringify(result.safePayload)).not.toContain('secret-material');
    expect(mapNotificationEvent({ eventType: 'AUTH.EMPLOYEE_INVITATION', aggregateType: 'USER', aggregateId: recipient.userId, payload }, { recipient: { ...recipient, audience: 'CUSTOMER' } }).kind).toBe('REJECTED');
  });

  it('welcomes the person with who invited them, the role and a validity in hours', () => {
    const rendered = renderNotificationTemplate({ templateKey: 'auth.employee.invitation', templateVersion: 'v1', data: { appUrl: 'https://ocpool.test', recipientName: 'Nueva <b>Persona</b>', actionUrl: 'https://ocpool.test/auth/recovery?token=abc&invite=1', expiresMinutes: 4320, senderName: 'Ana Gerente', roleLabel: 'Ventas' } });
    expect(rendered.subject).toBe('Te damos la bienvenida al equipo de OCPOOL');
    expect(rendered.text).toContain('Ana Gerente te invitó al espacio interno de OCPOOL como Ventas');
    expect(rendered.text).toContain('72 horas');
    expect(rendered.html).toContain('Crear contraseña');
    expect(rendered.html).not.toContain('<b>Persona</b>');
    // La recuperación ya no dice "Solicitaste": también la puede pedir gerencia.
    const reset = renderNotificationTemplate({ templateKey: 'auth.employee.password_reset', templateVersion: 'v1', data: { appUrl: 'https://ocpool.test', recipientName: 'Ana', actionUrl: 'https://ocpool.test/auth/recovery?token=abc', expiresMinutes: 15 } });
    expect(reset.text).toContain('Recibimos una solicitud para restablecer tu acceso');
    expect(reset.text).toContain('15 minutos');
  });
});
