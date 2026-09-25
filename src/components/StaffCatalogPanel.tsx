'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffTopNav from '@/components/StaffTopNav';
import StaffCatalogConceptsTab from '@/components/StaffCatalogConceptsTab';
import StaffCatalogPriceListsTab from '@/components/StaffCatalogPriceListsTab';
import StaffCatalogReviewTab from '@/components/StaffCatalogReviewTab';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton, PrivateSkeleton, PrivateTabs } from '@/components/private/ui';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import type { CatalogCapabilities, SpecialConceptGroup } from '@/lib/staff-catalog-types';

type CatalogTab = 'items' | 'price-lists' | 'review';

function normalizeCatalogTab(value: string | null, canReview: boolean): CatalogTab {
  if (value === 'price-lists') return 'price-lists';
  if (value === 'review' && canReview) return 'review';
  return 'items';
}

function catalogTabHref(tab: CatalogTab): string {
  return tab === 'items' ? '/staff/catalog' : `/staff/catalog?tab=${tab}`;
}

const TAB_LABELS: Record<CatalogTab, string> = { items: 'Conceptos', 'price-lists': 'Listas de precio', review: 'Por revisar' };

export default function StaffCatalogPanel() {
  const searchParams = useSearchParams();
  const [capabilities, setCapabilities] = useState<CatalogCapabilities | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/staff/capabilities', { credentials: 'include', cache: 'no-store' });
        const result = await readApiResponse<CatalogCapabilities>(response, 'No fue posible validar los permisos.');
        if (cancelled) return;
        if (!result.ok) {
          if (result.kind === 'forbidden') setRestricted(true);
          else setCapabilitiesError(result.message);
          return;
        }
        setCapabilities(result.data);
        if (!result.data.catalogRead) { setRestricted(true); return; }
        if (result.data.catalogManage) {
          const specialResponse = await fetch('/api/staff/catalog/special-concepts', { credentials: 'include', cache: 'no-store' });
          const groups = await readApiResponseOrThrow<SpecialConceptGroup[]>(specialResponse, 'No fue posible cargar los conceptos por revisar.');
          if (!cancelled) setPendingReviewCount(groups.filter((group) => group.status !== 'PROMOTED').length);
        }
      } catch (caught) {
        if (!cancelled) setCapabilitiesError(caught instanceof Error ? caught.message : 'No fue posible validar los permisos.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeTab = normalizeCatalogTab(searchParams.get('tab'), capabilities?.catalogManage ?? false);

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <header className="staff-header">
        <WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" />
        <StaffTopNav />
        <div className="staff-header__tools">
          <Link className="staff-header__home" href="/staff">Volver al dashboard</Link>
          <div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Catálogo y precios</div>
        </div>
      </header>
      <div className="staff-content catalog-content">
        <div className="staff-intro">
          <div>
            <p className="staff-kicker">Fuente comercial</p>
            <h1>Catálogo</h1>
            <p className="staff-intro__copy">Conceptos, listas de precio y conceptos especiales pendientes de revisar, cada uno en su propio lugar.</p>
          </div>
        </div>
        {capabilitiesError && <PrivateBlockingState title="No fue posible validar las acciones." onRetry={() => window.location.reload()}>{capabilitiesError}</PrivateBlockingState>}
        {!capabilitiesError && restricted && (
          <PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>
            Inicia sesión con una cuenta de empleado autorizada para consultar el catálogo.
          </PrivateBlockingState>
        )}
        {!capabilitiesError && !restricted && !capabilities && <PrivateSkeleton label="Validando permisos" />}
        {!capabilitiesError && !restricted && capabilities && (
          <>
            <PrivateTabs
              ariaLabel="Secciones del catálogo"
              tabpanelId="catalog-tabpanel"
              activeKey={activeTab}
              tabs={[
                { key: 'items', label: TAB_LABELS.items, href: catalogTabHref('items') },
                { key: 'price-lists', label: TAB_LABELS['price-lists'], href: catalogTabHref('price-lists') },
                ...(capabilities.catalogManage ? [{ key: 'review', label: TAB_LABELS.review, href: catalogTabHref('review'), badge: pendingReviewCount }] : []),
              ]}
            />
            <section id="catalog-tabpanel" role="tabpanel" aria-label={TAB_LABELS[activeTab]} className="catalog-tabpanel">
              {activeTab === 'items' && <StaffCatalogConceptsTab capabilities={capabilities} />}
              {activeTab === 'price-lists' && <StaffCatalogPriceListsTab capabilities={capabilities} />}
              {activeTab === 'review' && capabilities.catalogManage && <StaffCatalogReviewTab onPromoted={() => setPendingReviewCount((current) => Math.max(0, current - 1))} />}
            </section>
          </>
        )}
      </div>
    </PrivateSurfaceRoot>
  );
}
