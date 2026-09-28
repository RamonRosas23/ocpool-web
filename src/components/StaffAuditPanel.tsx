'use client';

import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffHeader from '@/components/StaffHeader';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateDatePicker, PrivateLinkButton, PrivateSelect } from '@/components/private/ui';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { formatAuditDetail } from '@/lib/audit-detail-format';

const CATEGORY_OPTIONS = ['', 'commercial', 'communication', 'documents', 'notifications', 'team', 'security', 'signins'] as const;
// Ambas se leen de los eventos de identidad y exigen el permiso de seguridad.
const SECURITY_CATEGORIES: ReadonlyArray<Category> = ['security', 'signins'];
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
  actorRole?: string | null;
  actorKey: string | null;
  entityLabel: string;
  entityLink: { href: string } | null;
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
  team: 'Equipo y accesos',
  security: 'Seguridad',
  signins: 'Inicios de sesión',
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

function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', { timeStyle: 'short', timeZone: timezone }).format(new Date(value));
}

// Resta días a una fecha de calendario (YYYY-MM-DD) sin pasar por la zona horaria del navegador.
function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayLabel(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return 'Hoy';
  if (dayKey === shiftCalendarDate(todayKey, -1)) return 'Ayer';
  const label = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${dayKey}T12:00:00.000Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const RANGE_PRESETS: ReadonlyArray<{ key: string; label: string; days: number }> = [
  { key: 'today', label: 'Hoy', days: 1 },
  { key: '7', label: '7 días', days: 7 },
  { key: '30', label: '30 días', days: 30 },
];

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

  const timezone = data?.meta.timezone ?? 'America/Chihuahua';
  const todayKey = dateInputValue(new Date().toISOString(), timezone);
  // Rango realmente aplicado: el del usuario o, si nunca eligió uno, el que el servidor usó por defecto.
  const appliedFrom = query.from || (data ? dateInputValue(data.meta.from, timezone) : '');
  const appliedTo = query.to || (data ? dateInputValue(data.meta.to, timezone) : '');
  const pendingChanges = Boolean(data) && (draftFrom !== appliedFrom || draftTo !== appliedTo || draftCategory !== query.category || draftOutcome !== query.outcome);

  // Rangos rápidos: fijan las fechas y aplican al momento con la categoría/resultado elegidos.
  const applyPreset = (days: number) => {
    const from = shiftCalendarDate(todayKey, -(days - 1));
    setDraftFrom(from);
    setDraftTo(todayKey);
    setData(null);
    setQuery({ from, to: todayKey, category: draftCategory, outcome: draftOutcome, cursor: null });
  };

  const clearCategoryAndOutcome = () => {
    setDraftCategory('');
    setDraftOutcome('');
    setData(null);
    setQuery({ from: draftFrom, to: draftTo, category: '', outcome: '', cursor: null });
  };

  const loadPrevious = () => {
    if (!data?.nextCursor || loading) return;
    setQuery((current) => ({ ...current, cursor: data.nextCursor }));
  };

  if (accessDenied) return <RestrictedAudit />;
  if (error && !data) return <PrivateSurfaceRoot className="staff-shell"><PrivateBlockingState title="No fue posible cargar la auditoría." onRetry={() => { setError(null); setReloadToken((current) => current + 1); }}>{error}</PrivateBlockingState></PrivateSurfaceRoot>;

  const isSecurity = SECURITY_CATEGORIES.includes(query.category as Category);
  const isSignIns = query.category === 'signins';
  const items = data?.items ?? [];
  // Agrupar por día de negocio: se lee "qué pasó hoy / ayer" de un vistazo y cada fila sólo muestra la hora.
  const dayGroups = items.reduce<Array<{ key: string; items: AuditEntry[] }>>((groups, item) => {
    const key = dateInputValue(item.occurredAt, timezone);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
    return groups;
  }, []);
  const activePreset = RANGE_PRESETS.find((preset) => appliedTo === todayKey && appliedFrom === shiftCalendarDate(todayKey, -(preset.days - 1)))?.key ?? null;
  const activeFilterLabels = [query.category ? CATEGORY_LABELS[query.category] : null, query.outcome ? OUTCOME_LABELS[query.outcome] : null].filter((label): label is string => Boolean(label));

  return <PrivateSurfaceRoot className="staff-shell audit-shell">
    <StaffHeader />
    <div className="staff-content audit-content" aria-busy={loading}>
      <section className="audit-hero"><div><p className="staff-kicker">Gobierno operativo</p><h1>{isSignIns ? <>Inicios de <em>sesión</em></> : isSecurity ? <>Eventos de <em>seguridad</em></> : <>Auditoría <em>operativa</em></>}</h1><p className="staff-intro__copy">Una lectura trazable de los movimientos autorizados, con identidad y datos sensibles reducidos al mínimo necesario.</p></div><div className="audit-scope"><p className="staff-section-label">Alcance actual</p><strong>{isSecurity ? 'Identidad y acceso' : 'Actividad del negocio'}</strong><span>{data?.meta.timezone ?? 'America/Chihuahua'} · {data?.meta.freshness === 'fresh' ? 'Actualizado al consultar' : '—'}</span></div></section>

      <section className="audit-toolbar" aria-label="Filtros de auditoría"><PrivateDatePicker id="audit-from" label="Desde" required value={draftFrom} onValueChange={setDraftFrom} /><PrivateDatePicker id="audit-to" label="Hasta" required value={draftTo} onValueChange={setDraftTo} /><PrivateSelect id="audit-category" optionalHint={false} label="Filtrar por categoría" value={draftCategory} onValueChange={(value) => setDraftCategory(value as Category)} options={CATEGORY_OPTIONS.filter((category): category is Exclude<Category, ''> => category !== '' && (!SECURITY_CATEGORIES.includes(category) || Boolean(capabilities.auditSecurityRead))).map((category) => ({ value: category, label: CATEGORY_LABELS[category] }))} placeholder="Toda la actividad operativa" /><PrivateSelect id="audit-outcome" optionalHint={false} label="Filtrar por resultado" value={draftOutcome} onValueChange={(value) => setDraftOutcome(value as Outcome)} options={OUTCOME_OPTIONS.filter((outcome): outcome is Exclude<Outcome, ''> => outcome !== '').map((outcome) => ({ value: outcome, label: OUTCOME_LABELS[outcome] }))} placeholder="Todos los resultados" /><div className="audit-toolbar__apply"><button className="staff-button staff-button--dark" type="button" onClick={applyFilters} disabled={loading || !draftFrom || !draftTo}>Aplicar filtros</button>{pendingChanges && !loading && <small className="audit-toolbar__pending">Cambios sin aplicar</small>}</div></section>

      <div className="audit-quickbar"><div className="analytics-presets"><span id="audit-presets-label">Rango rápido</span><div className="analytics-presets__track" role="group" aria-labelledby="audit-presets-label">{RANGE_PRESETS.map((preset) => <button key={preset.key} type="button" className={activePreset === preset.key ? 'is-selected' : ''} aria-pressed={activePreset === preset.key} disabled={loading} onClick={() => applyPreset(preset.days)}>{preset.label}</button>)}</div></div>{activeFilterLabels.length > 0 && <div className="audit-quickbar__active"><span>Filtrando por {activeFilterLabels.join(' · ')}</span><button type="button" className="audit-quickbar__clear" disabled={loading} onClick={clearCategoryAndOutcome}>Quitar filtros</button></div>}</div>

      {error && <p className="staff-error" role="alert">{error} <button className="audit-inline-retry" type="button" onClick={() => setReloadToken((current) => current + 1)}>Reintentar</button></p>}
      <section className="audit-workspace" aria-label={isSecurity ? 'Eventos de seguridad' : 'Registro de auditoría'}>
        <div className="audit-workspace__head"><div><p className="staff-section-label">{isSecurity ? 'Acceso y sesiones' : 'Registro consultable'}</p><h2>{isSignIns ? 'Quién entró y quién no pudo' : isSecurity ? 'Eventos de seguridad' : 'Auditoría operativa'}</h2></div><div className="audit-workspace__meta"><span>{loading ? 'Consultando…' : `${items.length} evento${items.length === 1 ? '' : 's'} visibles`}</span><small>Los eventos históricos no son editables desde esta vista.</small></div></div>
        {loading && !data && <div className="audit-loading" role="status" aria-live="polite"><span /><span /><span /><strong>Consultando trazabilidad…</strong></div>}
        {!loading && data && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span><h2>No hay eventos en este periodo.</h2><p>Prueba con otro rango o retira algún filtro para ampliar la lectura.</p></div>}
        {items.length > 0 && <div className="audit-days" aria-live="polite">{dayGroups.map((group, groupIndex) => <section className="audit-day" key={group.key} aria-labelledby={`audit-day-${group.key}`}><h3 className="audit-day__label" id={`audit-day-${group.key}`}>{dayLabel(group.key, todayKey)}<span>{group.items.length}{groupIndex === dayGroups.length - 1 && data?.nextCursor ? '+' : ''} evento{group.items.length === 1 && !(groupIndex === dayGroups.length - 1 && data?.nextCursor) ? '' : 's'}</span></h3><ul className="audit-list">{group.items.map((item) => <li className="audit-entry" data-testid="audit-entry" key={item.eventKey}><div className="audit-entry__main"><div className="audit-entry__top"><span className={outcomeClass(item.outcome)}>{OUTCOME_LABELS[item.outcome]}</span><time dateTime={item.occurredAt} title={formatDate(item.occurredAt, timezone)}>{formatTime(item.occurredAt, timezone)}</time></div><h4>{item.action}</h4><p>{item.entityLink ? <Link className="audit-entry__entity-link" href={item.entityLink.href}>{item.entityLabel}</Link> : item.entityLabel} · {item.actorLabel}{item.actorRole && <span className="audit-entry__role">{item.actorRole}</span>}</p></div>{item.details.length > 0 && <dl className="audit-entry__details">{item.details.map((raw) => { const detail = formatAuditDetail(raw, data?.meta.timezone); return <div key={raw.label}><dt>{detail.label}</dt><dd title={detail.value}>{detail.value}</dd></div>; })}</dl>}</li>)}</ul></section>)}</div>}
        {!loading && data?.nextCursor && <div className="audit-load-more"><button className="staff-button" type="button" onClick={loadPrevious}>Cargar eventos anteriores</button><span aria-live="polite">Se conservan los filtros actuales.</span></div>}
      </section>
    </div>
  </PrivateSurfaceRoot>;
}
