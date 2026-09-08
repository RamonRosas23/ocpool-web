import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_KEYS,
  ROLE_DEFINITIONS,
  hasPermission,
  permissionKeysForRoles,
  requirePermission,
} from '@/server/auth/permissions';

describe('authorization policy', () => {
  it('defines the approved least-privilege role catalog', () => {
    expect(ALL_PERMISSION_KEYS).toHaveLength(22);
    expect(permissionKeysForRoles(['customer'])).toEqual(new Set([
      'portal.self.read',
      'portal.self.authenticate',
      'identity.session.read',
    ]));
    expect(permissionKeysForRoles(['sales'])).toEqual(new Set([
      'identity.session.read',
      'identity.session.revoke',
      'identity.users.read',
      'portal.self.read',
      'requests.read',
      'requests.create',
      'requests.assign',
      'requests.status.update',
      'catalog.read',
      'prices.read',
      'quotes.read',
      'quotes.create',
      'quotes.send',
    ]));
    expect(permissionKeysForRoles(['manager'])).toEqual(expect.any(Set));
    expect(permissionKeysForRoles(['manager'])).toContain('catalog.manage');
    expect(permissionKeysForRoles(['manager'])).toContain('prices.manage');
    expect(permissionKeysForRoles(['manager'])).toContain('quotes.approve_discount');
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
});
