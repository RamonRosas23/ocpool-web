import { AppError } from '@/server/http/errors';
import { PERMISSION_CATALOG, ROLE_DEFINITIONS } from '@/server/auth/constants';

export { ROLE_DEFINITIONS } from '@/server/auth/constants';

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map(({ key }) => key);

export type PermissionSubject = {
  permissionKeys: ReadonlySet<string>;
};

export function permissionKeysForRoles(roleKeys: readonly string[]): Set<string> {
  const permissions = new Set<string>();

  for (const roleKey of roleKeys) {
    const definition = ROLE_DEFINITIONS[roleKey as keyof typeof ROLE_DEFINITIONS];
    if (!definition) continue;
    for (const permission of definition.permissions) permissions.add(permission);
  }

  return permissions;
}

export function hasPermission(subject: PermissionSubject, permission: string): boolean {
  return subject.permissionKeys.has(permission);
}

export function requirePermission(subject: PermissionSubject, permission: string): void {
  if (hasPermission(subject, permission)) return;
  throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
}
