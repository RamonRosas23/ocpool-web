import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PrivateShell from '@/components/private/PrivateShell';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { visibleStaffNavigation } from '@/components/private/navigation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Harness del shell privado | OCPOOL',
  robots: { index: false, follow: false },
};

const STAFF_HARNESS_CONTEXT = {
  user: { displayName: 'Entorno local', email: 'local@example.test' },
  roleLabel: 'Administrador local',
  capabilities: {
    metricsRead: true,
    requestsRead: true,
    quotesRead: true,
    catalogRead: true,
    notificationsRead: true,
    auditRead: true,
  },
} as const;

const PORTAL_HARNESS_CONTEXT = {
  user: { displayName: 'Cliente sintético', email: 'cliente@example.test' },
  roleLabel: 'Cliente',
  capabilities: { requestsRead: true },
} as const;

const PORTAL_HARNESS_NAVIGATION = [
  { key: 'portal', href: '/portal', label: 'Mis expedientes', capability: 'requestsRead' },
] as const;

type HarnessSearchParams = Promise<{ surface?: string | string[] }>;

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PrivateShellHarnessPage({ searchParams }: { searchParams?: HarnessSearchParams }) {
  if (process.env.NODE_ENV === 'production') notFound();

  const params = searchParams ? await searchParams : {};
  const surface = firstSearchParam(params.surface) === 'portal' ? 'portal' : 'staff';
  const context = surface === 'staff' ? STAFF_HARNESS_CONTEXT : PORTAL_HARNESS_CONTEXT;
  const navigation = surface === 'staff' ? visibleStaffNavigation(STAFF_HARNESS_CONTEXT.capabilities) : PORTAL_HARNESS_NAVIGATION;

  return (
    <PrivateShell surface={surface} context={context} navigation={navigation}>
      <PrivateSurfaceRoot className={surface === 'staff' ? 'staff-shell private-harness__surface' : 'client-portal private-harness__surface'}>
        <section className="private-harness__content" aria-labelledby="private-harness-title">
          <p className="private-harness__kicker">Harness local · {surface === 'staff' ? 'staff' : 'portal'}</p>
          <h1 id="private-harness-title">Shell privado verificable</h1>
          <p>Contenido sintético para revisar navegación, identidad, retorno, foco y estados sin usar datos reales.</p>
          <div className="private-harness__grid">
            <section aria-labelledby="private-harness-navigation-title">
              <h2 id="private-harness-navigation-title">Navegación activa</h2>
              <p>{navigation.length} destinos visibles según capabilities de prueba.</p>
            </section>
            <section aria-labelledby="private-harness-session-title">
              <h2 id="private-harness-session-title">Sesión sintética</h2>
              <p>{context.user.displayName} · {context.roleLabel}</p>
            </section>
          </div>
        </section>
      </PrivateSurfaceRoot>
    </PrivateShell>
  );
}
