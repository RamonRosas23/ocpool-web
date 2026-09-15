'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import DateField from '@/components/DateField';
import SelectField from '@/components/SelectField';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';

const CATEGORY_OPTIONS = ['', 'commercial', 'communication', 'documents', 'notifications', 'security'] as const;
const OUTCOME_OPTIONS = ['', 'SUCCESS', 'DENIED', 'FAILURE'] as const;
type Category = (typeof CATEGORY_OPTIONS)[number];
type Outcome = (typeof OUTCOME_OPTIONS)[number];

type AuditEntry = {
  eventKey: string;
  occurredAt: string;
  category: Exclude<Category, ''>;
  action: string;
  outcome: Exclude<Outcome, ''>;
  actorLabel: string;
  actorKey: string | null;
  entityLabel: string;
  details: Array<{ label: string; value: string }>;
};

type AuditResponse = {
  items: AuditEntry[];
  nextCursor: string | null;
  meta: { from: string; to: string; timezone: string; scope: 'operational' | 'security'; freshness: 'fresh' };
};

type CapabilitiesResponse = { auditRead?: boolean; auditSecurityRead?: boolean };
type ApiError = { error?: { code?: string; message?: string } };

const CATEGORY_LABELS: Record<Exclude<Category, ''>, string> = {
  commercial: 'Comercial',
  communication: 'Comunicación',
  documents: 'Documentos',
  notifications: 'Notificaciones',
  security: 'Seguridad',
};

const OUTCOME_LABELS: Record<Exclude<Outcome, ''>, string> = {
  SUCCESS: 'Exitoso',
  DENIED: 'Denegado',
  FAILURE: 'Fallido',
};

function formatDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
}

function dateInputValue(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function responseError(response: Response): Promise<{ code?: string; message: string }> {
  try {
    const body = await response.json() as ApiError;
    return { code: body.error?.code, message: body.error?.message ?? 'No fue posible cargar la auditoría.' };
  } catch {
    return { message: 'No fue posible cargar la auditoría.' };
  }
}

function queryString(query: { from: string; to: string; category: Category; outcome: Outcome; cursor: string | null }): string {
  const params = new URLSearchParams({ limit: '25' });
  if (query.from && query.to) { params.set('from', query.from); params.set('to', query.to); }
  if (query.category) params.set('category', query.category);
  if (query.outcome) params.set('outcome', query.outcome);
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

function outcomeClass(outcome: AuditEntry['outcome']): string {
  return `audit-outcome audit-outcome--${outcome.toLowerCase()}`;
}

function RestrictedAudit() {
  return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><section className="staff-empty"><WorkspaceLogo className="staff-empty__logo" /><p className="staff-kicker">Área interna</p><h1>Acceso restringido.</h1><p>Necesitas una cuenta de empleado con permiso de auditoría para consultar esta operación.</p><div className="staff-empty__actions"><Link className="staff-button staff-button--dark" href="/login">Iniciar sesión</Link><Link className="staff-empty__link" href="/">Volver al sitio</Link></div></section></PrivateSurfaceRoot>;
}

export default function StaffAuditPanel() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse>({});
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [draftCategory, setDraftCategory] = useState<Category>('');
  const [draftOutcome, setDraftOutcome] = useState<Outcome>('');
  const [query, setQuery] = useState({ from: '', to: '', category: '' as Category, outcome: '' as Outcome, cursor: null as string | null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestNumber = useRef(0);
  const rangeInitialized = useRef(false);

  const load = useCallback(async (signal: AbortSignal) => {
    const currentRequest = requestNumber.current + 1;
    requestNumber.current = currentRequest;
    setLoading(true);
    setError(null);
    try {
      const [auditResponse, capabilitiesResponse] = await Promise.all([
        fetch(`/api/staff/audit?${queryString(query)}`, { credentials: 'include', cache: 'no-store', signal }),
        fetch('/api/staff/capabilities', { credentials: 'include', cache: 'no-store', signal }),
      ]);
      if (!auditResponse.ok) {
        const failure = await responseError(auditResponse);
        if (failure.code === 'UNAUTHORIZED' || failure.code === 'FORBIDDEN') setAccessDenied(true);
        throw new Error(failure.message);
      }
      const next = await auditResponse.json() as AuditResponse;
      const nextCapabilities = capabilitiesResponse.ok ? await capabilitiesResponse.json() as CapabilitiesResponse : {};
      if (requestNumber.current !== currentRequest) return;
      setCapabilities(nextCapabilities);
      setAccessDenied(false);
      setData((current) => query.cursor && current ? { ...next, items: [...current.items, ...next.items] } : next);
      if (!rangeInitialized.current) {
        setDraftFrom(dateInputValue(next.meta.from, next.meta.timezone));
        setDraftTo(dateInputValue(next.meta.to, next.meta.timezone));
        rangeInitialized.current = true;
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar la auditoría.');
    } finally {
      if (!signal.aborted && requestNumber.current === currentRequest) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadToken]);

  const applyFilters = () => {
    setData(null);
    setQuery({ from: draftFrom, to: draftTo, category: draftCategory, outcome: draftOutcome, cursor: null });
  };

  const loadPrevious = () => {
    if (!data?.nextCursor || loading) return;
    setQuery((current) => ({ ...current, cursor: data.nextCursor }));
  };

  if (accessDenied) return <RestrictedAudit />;
  if (error && !data) return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><section className="staff-empty"><span className="staff-empty__mark">!</span><p className="staff-kicker">Auditoría operativa</p><h1>No fue posible cargar la auditoría.</h1><p role="alert">{error}</p><button className="staff-button staff-button--dark" type="button" onClick={() => { setError(null); setReloadToken((current) => current + 1); }}>Reintentar</button></section></PrivateSurfaceRoot>;

  const isSecurity = query.category === 'security';
  const items = data?.items ?? [];

  return <PrivateSurfaceRoot className="staff-shell audit-shell">
    <header className="staff-header"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><nav className="audit-nav" aria-label="Navegación de operaciones"><Link href="/staff">Dashboard</Link><Link href="/staff/requests">Solicitudes</Link><Link href="/staff/quotes">Cotizaciones</Link><Link href="/staff/catalog">Catálogo</Link><Link href="/staff/notifications">Notificaciones</Link><Link className="is-current" href="/staff/audit" aria-current="page">Auditoría</Link></nav><div className="staff-header__tools"><Link className="staff-header__home" href="/staff">Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Trazabilidad protegida</div></div></header>
    <div className="staff-content audit-content" aria-busy={loading}>
      <section className="audit-hero"><div><p className="staff-kicker">Gobierno operativo</p><h1>{isSecurity ? <>Eventos de <em>seguridad</em></> : <>Auditoría <em>operativa</em></>}</h1><p className="staff-intro__copy">Una lectura trazable de los movimientos autorizados, con identidad y datos sensibles reducidos al mínimo necesario.</p></div><div className="audit-scope"><p className="staff-section-label">Alcance actual</p><strong>{isSecurity ? 'Identidad y acceso' : 'Actividad del negocio'}</strong><span>{data?.meta.timezone ?? 'America/Chihuahua'} · {data?.meta.freshness === 'fresh' ? 'Actualizado al consultar' : '—'}</span></div></section>

      <section className="audit-toolbar" aria-label="Filtros de auditoría"><label htmlFor="audit-from"><span>Desde</span><DateField id="audit-from" ariaLabel="Desde" value={draftFrom} onValueChange={setDraftFrom} /></label><label htmlFor="audit-to"><span>Hasta</span><DateField id="audit-to" ariaLabel="Hasta" value={draftTo} onValueChange={setDraftTo} /></label><label htmlFor="audit-category"><span>Filtrar por categoría</span><SelectField id="audit-category" ariaLabel="Filtrar por categoría" value={draftCategory} onValueChange={(value) => setDraftCategory(value as Category)} options={CATEGORY_OPTIONS.filter((category): category is Exclude<Category, ''> => category !== '' && (category !== 'security' || Boolean(capabilities.auditSecurityRead))).map((category) => ({ value: category, label: CATEGORY_LABELS[category] }))} placeholder="Toda la actividad operativa" /></label><label htmlFor="audit-outcome"><span>Filtrar por resultado</span><SelectField id="audit-outcome" ariaLabel="Filtrar por resultado" value={draftOutcome} onValueChange={(value) => setDraftOutcome(value as Outcome)} options={OUTCOME_OPTIONS.filter((outcome): outcome is Exclude<Outcome, ''> => outcome !== '').map((outcome) => ({ value: outcome, label: OUTCOME_LABELS[outcome] }))} placeholder="Todos los resultados" /></label><button className="staff-button staff-button--dark" type="button" onClick={applyFilters} disabled={loading || !draftFrom || !draftTo}>Aplicar filtros</button></section>

      {error && <p className="staff-error" role="alert">{error} <button className="audit-inline-retry" type="button" onClick={() => setReloadToken((current) => current + 1)}>Reintentar</button></p>}
      <section className="audit-workspace" aria-label={isSecurity ? 'Eventos de seguridad' : 'Registro de auditoría'}>
        <div className="audit-workspace__head"><div><p className="staff-section-label">{isSecurity ? 'Acceso y sesiones' : 'Registro consultable'}</p><h2>{isSecurity ? 'Eventos de seguridad' : 'Auditoría operativa'}</h2></div><div className="audit-workspace__meta"><span>{loading ? 'Consultando…' : `${items.length} evento${items.length === 1 ? '' : 's'} visibles`}</span><small>Los eventos históricos no son editables desde esta vista.</small></div></div>
        {loading && !data && <div className="audit-loading" role="status" aria-live="polite"><span /><span /><span /><strong>Consultando trazabilidad…</strong></div>}
        {!loading && data && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark">—</span><h2>No hay eventos en este periodo.</h2><p>Prueba con otro rango o retira algún filtro para ampliar la lectura.</p></div>}
        {items.length > 0 && <ul className="audit-list" aria-live="polite">{items.map((item) => <li className="audit-entry" data-testid="audit-entry" key={item.eventKey}><div className="audit-entry__main"><div className="audit-entry__top"><span className={outcomeClass(item.outcome)}>{OUTCOME_LABELS[item.outcome]}</span><time dateTime={item.occurredAt}>{formatDate(item.occurredAt, data?.meta.timezone ?? 'America/Chihuahua')}</time></div><h3>{item.action}</h3><p>{item.entityLabel} · {item.actorLabel}</p></div>{item.details.length > 0 && <dl className="audit-entry__details">{item.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}</li>)}</ul>}
        {!loading && data?.nextCursor && <div className="audit-load-more"><button className="staff-button" type="button" onClick={loadPrevious}>Cargar eventos anteriores</button><span aria-live="polite">Se conservan los filtros actuales.</span></div>}
      </section>
    </div>
  </PrivateSurfaceRoot>;
}
