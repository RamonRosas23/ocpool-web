import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_KEYS,
  ROLE_DEFINITIONS,
  hasPermission,
  permissionKeysForRoles,
  requirePermission,
} from '@/server/auth/permissions';
import {
  assertStaffAssigneeFilterScope,
  assertStaffAssigneeTargetScope,
  canReadGlobalStaffRequests,
  isStaffRequestInReadScope,
  requireStaffRequestReadScope,
  staffRequestReadScopeWhere,
} from '@/server/auth/request-scope';

describe('authorization policy', () => {
  it('defines the approved least-privilege role catalog', () => {
    expect(ALL_PERMISSION_KEYS).toHaveLength(50);
    expect(permissionKeysForRoles(['customer'])).toEqual(new Set([
      'portal.self.read',
      'portal.self.authenticate',
      'identity.session.read',
      'messaging.read',
      'messaging.send',
      'files.read',
      'files.upload',
      'files.download',
      'files.delete',
      'quotes.pdf.read',
      'quotes.accept',
    ]));
    expect(permissionKeysForRoles(['sales'])).toEqual(new Set([
      'identity.session.read',
      'identity.session.revoke',
      'identity.users.read',
      'portal.self.read',
      'requests.read',
      'requests.create',
      'requests.assign',
      'requests.claim',
      'requests.edit',
      'requests.status.update',
      'catalog.read',
      'prices.read',
      'quotes.read',
      'quotes.create',
      'quotes.send',
      'quotes.pdf.read',
      'quotes.pdf.generate',
      'notifications.read',
      'metrics.read',
      'messaging.read',
      'messaging.send',
      'messaging.internal_notes.read',
      'messaging.internal_notes.write',
      'files.read',
      'files.upload',
      'files.download',
      'files.delete',
      'files.internal.read',
      'projects.read',
      'projects.create',
      'projects.manage',
    ]));
    expect(permissionKeysForRoles(['manager'])).toEqual(expect.any(Set));
    expect(permissionKeysForRoles(['manager'])).toContain('projects.create');
    expect(permissionKeysForRoles(['manager'])).toContain('projects.manage');
    expect(permissionKeysForRoles(['manager'])).toContain('catalog.manage');
    expect(permissionKeysForRoles(['manager'])).toContain('prices.manage');
    expect(permissionKeysForRoles(['manager'])).toContain('quotes.approve_discount');
    expect(permissionKeysForRoles(['manager'])).toContain('metrics.read.global');
    expect(permissionKeysForRoles(['manager'])).toContain('requests.read.global');
    expect(permissionKeysForRoles(['manager'])).toContain('audit.read');
    expect(permissionKeysForRoles(['manager'])).toContain('identity.users.manage');
    expect(permissionKeysForRoles(['manager'])).toContain('requests.claim');
    expect(permissionKeysForRoles(['manager'])).toContain('customer.portal.invite');
    expect(permissionKeysForRoles(['manager'])).not.toContain('audit.security.read');
    expect(permissionKeysForRoles(['manager'])).not.toContain('quotes.approval.override');
    expect(permissionKeysForRoles(['sales'])).not.toContain('audit.read');
    expect(permissionKeysForRoles(['sales'])).not.toContain('requests.read.global');
    expect(permissionKeysForRoles(['sales'])).not.toContain('identity.users.manage');
    expect(permissionKeysForRoles(['sales'])).not.toContain('customer.portal.invite');
    expect(permissionKeysForRoles(['sales'])).not.toContain('quotes.approval.override');
    expect(permissionKeysForRoles(['customer'])).not.toContain('audit.read');
    expect(permissionKeysForRoles(['customer'])).not.toContain('identity.users.manage');
    expect(permissionKeysForRoles(['customer'])).not.toContain('audit.security.read');
    expect(permissionKeysForRoles(['admin'])).toContain('audit.read');
    expect(permissionKeysForRoles(['admin'])).toContain('audit.security.read');
    expect(permissionKeysForRoles(['admin'])).toEqual(new Set(ALL_PERMISSION_KEYS));
    expect(ROLE_DEFINITIONS.admin.systemManaged).toBe(true);
  });

  it('denies missing permissions by default', () => {
    const actor = { permissionKeys: new Set(['quotes.read']) };

    expect(hasPermission(actor, 'quotes.read')).toBe(true);
    expect(hasPermission(actor, 'quotes.edit_prices')).toBe(false);
    expect(() => requirePermission(actor, 'quotes.edit_prices')).toThrowError('No tienes permisos para realizar esta acción.');
    expect(() => requirePermission({ permissionKeys: new Set() }, 'quotes.read')).toThrow();
  });

  it('keeps staff request scope narrow unless the actor has the explicit global permission', () => {
    const sales = { userId: 'sales-user', type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['requests.read']), mfaVerified: true };
    const manager = { ...sales, permissionKeys: new Set(['requests.read', 'requests.read.global']) };

    expect(isStaffRequestInReadScope(sales, null)).toBe(true);
    expect(isStaffRequestInReadScope(sales, sales.userId)).toBe(true);
    expect(isStaffRequestInReadScope(sales, 'other-user')).toBe(false);
    expect(staffRequestReadScopeWhere(sales)).toEqual({ OR: [{ currentAssigneeId: null }, { currentAssigneeId: sales.userId }] });
    expect(isStaffRequestInReadScope(manager, 'other-user')).toBe(true);
    expect(staffRequestReadScopeWhere(manager)).toEqual({});
  });

  it('does not let a non-global operator assign work to another employee', () => {
    const sales = { userId: 'sales-user', type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['requests.assign']), mfaVerified: true };
    expect(() => assertStaffAssigneeTargetScope(sales, 'other-user')).toThrow('No tienes permisos para asignar la solicitud a otro responsable.');
    expect(() => assertStaffAssigneeTargetScope(sales, sales.userId)).not.toThrow();
  });

  it('never grants global staff scope to a non-employee actor, even with the permission key present', () => {
    const sales = { userId: 'sales-user', type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['requests.read.global']), mfaVerified: true };
    const customer = { userId: 'customer-user', type: 'CUSTOMER' as const, clientId: 'client-1', permissionKeys: new Set(['requests.read.global']), mfaVerified: true };

    expect(canReadGlobalStaffRequests(sales)).toBe(true);
    expect(canReadGlobalStaffRequests(customer)).toBe(false);
    expect(isStaffRequestInReadScope(customer, null)).toBe(false);
    expect(isStaffRequestInReadScope(customer, customer.userId)).toBe(false);
  });

  it('rejects a request outside scope with 404 NOT_FOUND, not 403, to avoid confirming it exists', () => {
    const sales = { userId: 'sales-user', type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['requests.read']), mfaVerified: true };
    const manager = { ...sales, permissionKeys: new Set(['requests.read', 'requests.read.global']) };

    expect(() => requireStaffRequestReadScope(sales, 'other-user')).toThrow('La solicitud no existe.');
    expect(() => requireStaffRequestReadScope(sales, null)).not.toThrow();
    expect(() => requireStaffRequestReadScope(sales, sales.userId)).not.toThrow();
    expect(() => requireStaffRequestReadScope(manager, 'other-user')).not.toThrow();
  });

  it('only forbids filtering the queue by another responsible when the actor lacks global scope', () => {
    const sales = { userId: 'sales-user', type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['requests.read']), mfaVerified: true };
    const manager = { ...sales, permissionKeys: new Set(['requests.read', 'requests.read.global']) };

    expect(() => assertStaffAssigneeFilterScope(sales, undefined)).not.toThrow();
    expect(() => assertStaffAssigneeFilterScope(sales, null)).not.toThrow();
    expect(() => assertStaffAssigneeFilterScope(sales, sales.userId)).not.toThrow();
    expect(() => assertStaffAssigneeFilterScope(sales, 'other-user')).toThrow('No tienes permisos para consultar la carga de otro responsable.');
    expect(() => assertStaffAssigneeFilterScope(manager, 'other-user')).not.toThrow();
  });
});
