'use client';

import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffTopNav from '@/components/StaffTopNav';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateDatePicker, PrivateLinkButton, PrivateSelect } from '@/components/private/ui';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';

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
  return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>Necesitas una cuenta de empleado con permiso de auditoría para consultar esta operación.</PrivateBlockingState></PrivateSurfaceRoot>;
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
      const auditResult = await readApiResponse<AuditResponse>(auditResponse, 'No fue posible cargar la auditoría.');
      if (!auditResult.ok) {
        if (auditResult.kind === 'forbidden') setAccessDenied(true);
        throw new Error(auditResult.message);
      }
      const next = auditResult.data;
      // Antes esto caía en silencio a `{}` si la respuesta no era `ok` -- un 500/401 transitorio en
      // /api/staff/capabilities apagaba la opción "Seguridad" del filtro de categoría como si el
      // rol no tuviera ese permiso, sin ninguna señal de que fue un fallo de red, no una restricción.
      const nextCapabilities = await readApiResponseOrThrow<CapabilitiesResponse>(capabilitiesResponse, 'No fue posible validar los permisos.');
      if (requestNumber.current !== currentRequest) return;
      setCapabilities(nextCapabilities);
      setAccessDenied(false);
      setData((current) => query.cursor && current ? { ...next, items: [...current.items, ...next.items] } : next);
      if (!rangeInitialized.current) {
        // Only seed the date pickers with the server's default range if the user hasn't
        // already typed their own dates while this (possibly slow, e.g. post-retry) request
        // was in flight — otherwise this would silently clobber their input once it resolves.
        setDraftFrom((current) => (current === '' ? dateInputValue(next.meta.from, next.meta.timezone) : current));
        setDraftTo((current) => (current === '' ? dateInputValue(next.meta.to, next.meta.timezone) : current));
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
  if (error && !data) return <PrivateSurfaceRoot className="staff-shell"><PrivateBlockingState title="No fue posible cargar la auditoría." onRetry={() => { setError(null); setReloadToken((current) => current + 1); }}>{error}</PrivateBlockingState></PrivateSurfaceRoot>;

  const isSecurity = query.category === 'security';
  const items = data?.items ?? [];

  return <PrivateSurfaceRoot className="staff-shell audit-shell">
    <header className="staff-header"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><StaffTopNav /><div className="staff-header__tools"><Link className="staff-header__home" href="/staff">Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Trazabilidad protegida</div></div></header>
    <div className="staff-content audit-content" aria-busy={loading}>
      <section className="audit-hero"><div><p className="staff-kicker">Gobierno operativo</p><h1>{isSecurity ? <>Eventos de <em>seguridad</em></> : <>Auditoría <em>operativa</em></>}</h1><p className="staff-intro__copy">Una lectura trazable de los movimientos autorizados, con identidad y datos sensibles reducidos al mínimo necesario.</p></div><div className="audit-scope"><p className="staff-section-label">Alcance actual</p><strong>{isSecurity ? 'Identidad y acceso' : 'Actividad del negocio'}</strong><span>{data?.meta.timezone ?? 'America/Chihuahua'} · {data?.meta.freshness === 'fresh' ? 'Actualizado al consultar' : '—'}</span></div></section>

      <section className="audit-toolbar" aria-label="Filtros de auditoría"><PrivateDatePicker id="audit-from" label="Desde" required value={draftFrom} onValueChange={setDraftFrom} /><PrivateDatePicker id="audit-to" label="Hasta" required value={draftTo} onValueChange={setDraftTo} /><PrivateSelect id="audit-category" label="Filtrar por categoría" value={draftCategory} onValueChange={(value) => setDraftCategory(value as Category)} options={CATEGORY_OPTIONS.filter((category): category is Exclude<Category, ''> => category !== '' && (category !== 'security' || Boolean(capabilities.auditSecurityRead))).map((category) => ({ value: category, label: CATEGORY_LABELS[category] }))} placeholder="Toda la actividad operativa" /><PrivateSelect id="audit-outcome" label="Filtrar por resultado" value={draftOutcome} onValueChange={(value) => setDraftOutcome(value as Outcome)} options={OUTCOME_OPTIONS.filter((outcome): outcome is Exclude<Outcome, ''> => outcome !== '').map((outcome) => ({ value: outcome, label: OUTCOME_LABELS[outcome] }))} placeholder="Todos los resultados" /><button className="staff-button staff-button--dark" type="button" onClick={applyFilters} disabled={loading || !draftFrom || !draftTo}>Aplicar filtros</button></section>

      {error && <p className="staff-error" role="alert">{error} <button className="audit-inline-retry" type="button" onClick={() => setReloadToken((current) => current + 1)}>Reintentar</button></p>}
      <section className="audit-workspace" aria-label={isSecurity ? 'Eventos de seguridad' : 'Registro de auditoría'}>
        <div className="audit-workspace__head"><div><p className="staff-section-label">{isSecurity ? 'Acceso y sesiones' : 'Registro consultable'}</p><h2>{isSecurity ? 'Eventos de seguridad' : 'Auditoría operativa'}</h2></div><div className="audit-workspace__meta"><span>{loading ? 'Consultando…' : `${items.length} evento${items.length === 1 ? '' : 's'} visibles`}</span><small>Los eventos históricos no son editables desde esta vista.</small></div></div>
        {loading && !data && <div className="audit-loading" role="status" aria-live="polite"><span /><span /><span /><strong>Consultando trazabilidad…</strong></div>}
        {!loading && data && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span><h2>No hay eventos en este periodo.</h2><p>Prueba con otro rango o retira algún filtro para ampliar la lectura.</p></div>}
        {items.length > 0 && <ul className="audit-list" aria-live="polite">{items.map((item) => <li className="audit-entry" data-testid="audit-entry" key={item.eventKey}><div className="audit-entry__main"><div className="audit-entry__top"><span className={outcomeClass(item.outcome)}>{OUTCOME_LABELS[item.outcome]}</span><time dateTime={item.occurredAt}>{formatDate(item.occurredAt, data?.meta.timezone ?? 'America/Chihuahua')}</time></div><h3>{item.action}</h3><p>{item.entityLabel} · {item.actorLabel}</p></div>{item.details.length > 0 && <dl className="audit-entry__details">{item.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}</li>)}</ul>}
        {!loading && data?.nextCursor && <div className="audit-load-more"><button className="staff-button" type="button" onClick={loadPrevious}>Cargar eventos anteriores</button><span aria-live="polite">Se conservan los filtros actuales.</span></div>}
      </section>
    </div>
  </PrivateSurfaceRoot>;
}
