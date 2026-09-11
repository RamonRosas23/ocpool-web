import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE } from '@/server/auth/constants';
import { hasPermission } from '@/server/auth/permissions';
import { getPrisma } from '@/server/db/client';
import { getSessionContext } from '@/server/auth/sessions';
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
    capabilities: {
      metricsRead: hasPermission(session.actor, 'metrics.read'),
      requestsRead: hasPermission(session.actor, 'requests.read'),
      quotesRead: hasPermission(session.actor, 'quotes.read'),
      catalogRead: hasPermission(session.actor, 'catalog.read'),
      notificationsRead: hasPermission(session.actor, 'notifications.read'),
      auditRead: hasPermission(session.actor, 'audit.read'),
    },
  };
}
