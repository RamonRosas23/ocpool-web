import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE } from '@/server/auth/constants';
import { hasPermission } from '@/server/auth/permissions';
import { getPrisma } from '@/server/db/client';
import { getSessionContext } from '@/server/auth/sessions';
import { compareToken, fingerprintToken } from '@/server/auth/crypto';
import type { PrivateStaffCapabilities } from '@/components/private/navigation';

export type PrivateShellSurface = 'staff' | 'portal';

export type PrivateShellContext = {
  user: { displayName: string; email: string };
  roleLabel: string;
  capabilities: PrivateStaffCapabilities;
};

export async function getPrivateShellContext(surface: PrivateShellSurface): Promise<PrivateShellContext | null> {
  const rawToken = (await cookies()).get(AUTH_SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const session = await getSessionContext(rawToken);
  if (!session) return null;

  const expectedType = surface === 'staff' ? 'EMPLOYEE' : 'CUSTOMER';
  if (session.actor.type !== expectedType) return null;

  const user = await getPrisma().user.findUnique({
    where: { id: session.actor.userId },
    select: {
      displayName: true,
      email: true,
      type: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!user || user.type !== expectedType) return null;

  return {
    user: { displayName: user.displayName, email: user.email },
    roleLabel: user.roles.map(({ role }) => role.name).join(' · ') || (surface === 'staff' ? 'Personal autorizado' : 'Cliente'),
    capabilities: staffCapabilities(session.actor),
  };
}

function staffCapabilities(subject: { permissionKeys: ReadonlySet<string> }): PrivateStaffCapabilities {
  return {
    metricsRead: hasPermission(subject, 'metrics.read'),
    requestsRead: hasPermission(subject, 'requests.read'),
    requestsClaim: hasPermission(subject, 'requests.claim'),
    quotesRead: hasPermission(subject, 'quotes.read'),
    catalogRead: hasPermission(subject, 'catalog.read'),
    notificationsRead: hasPermission(subject, 'notifications.read'),
    notificationsManage: hasPermission(subject, 'notifications.manage'),
    auditRead: hasPermission(subject, 'audit.read'),
    approvalsRead: hasPermission(subject, 'quotes.approve_discount'),
    projectsRead: hasPermission(subject, 'projects.read'),
    projectsManage: hasPermission(subject, 'projects.manage'),
    pricesManage: hasPermission(subject, 'prices.manage'),
    teamManage: hasPermission(subject, 'identity.users.manage'),
  };
}

/**
 * Lectura de sólo presentación para el header de staff (identidad, rol y navegación filtrada por
 * permisos). Corre en cada navegación del layout, así que -- a diferencia de
 * getPrivateShellContext -- no abre una transacción interactiva ni escribe `lastSeenAt`: una sola
 * consulta de lectura. La autorización real sigue ocurriendo en cada API vía getSessionContext;
 * aquí se aplican las mismas condiciones de validez (revocada, vencida, usuario inactivo, tipo de
 * cuenta, MFA pendiente) sólo para no mostrar la identidad de una sesión que ya no sirve.
 */
export async function getStaffHeaderContext(now: Date = new Date()): Promise<PrivateShellContext | null> {
  const rawToken = (await cookies()).get(AUTH_SESSION_COOKIE)?.value;
  if (!rawToken || rawToken.length < 40) return null;

  const session = await getPrisma().session.findUnique({
    where: { tokenHash: fingerprintToken(rawToken) },
    select: {
      tokenHash: true,
      revokedAt: true,
      expiresAt: true,
      mfaVerified: true,
      user: {
        select: {
          displayName: true,
          email: true,
          type: true,
          status: true,
          mfaRequired: true,
          roles: { select: { role: { select: { key: true, name: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
        },
      },
    },
  });
  if (!session || !compareToken(rawToken, session.tokenHash)) return null;
  if (session.revokedAt || session.expiresAt <= now) return null;
  const { user } = session;
  if (user.type !== 'EMPLOYEE' || user.status !== 'ACTIVE') return null;
  const requiresMfa = user.mfaRequired || user.roles.some(({ role }) => role.key === 'admin');
  if (requiresMfa && !session.mfaVerified) return null;

  const permissionKeys = new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)));
  return {
    user: { displayName: user.displayName, email: user.email },
    roleLabel: user.roles.map(({ role }) => role.name).join(' · ') || 'Personal autorizado',
    capabilities: staffCapabilities({ permissionKeys }),
  };
}
