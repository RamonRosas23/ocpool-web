'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronRight, KeyRound, Lock, Plus, ShieldCheck, UserRound, Users } from 'lucide-react';
import StaffHeader from '@/components/StaffHeader';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton } from '@/components/private/ui';
import { usePrivateToast } from '@/components/private/ui/PrivateToast';
import { ChangeRoleDialog, ConfirmMemberDialog, InviteMemberDialog, SuspendMemberDialog, type TeamMember } from '@/components/staff/TeamMemberDialogs';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { relativeTimeLabel } from '@/lib/relative-time';
import { revealWhenStacked } from '@/lib/reveal-when-stacked';
import { usePersistentState } from '@/lib/use-persistent-state';
import { TEAM_MEMBER_LOCK_MESSAGES, TEAM_MEMBER_STATE_LABELS, TEAM_ROLE_DESCRIPTIONS, TEAM_VIEWS, type TeamView } from '@/server/modules/team/domain';

type TeamResponse = { items: TeamMember[]; counts: Record<TeamView, number> };
type ConfirmKind = 'resend' | 'cancel' | 'reset' | 'sessions' | 'reactivate';

const VIEW_LABELS: Record<TeamView, string> = { active: 'Activas', invited: 'Invitaciones', suspended: 'Suspendidas', all: 'Todas' };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toLocaleUpperCase('es-MX');
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function workloadLabel(member: TeamMember): string {
  if (!member.openRequests && !member.projectsInTransition) return 'Sin trabajo a su cargo';
  return [member.openRequests ? plural(member.openRequests, 'expediente', 'expedientes') : null, member.projectsInTransition ? plural(member.projectsInTransition, 'proyecto', 'proyectos') : null].filter(Boolean).join(' · ');
}

function invitationLabel(member: TeamMember): string | null {
  if (!member.invitation) return member.state === 'invitation_expired' ? 'El enlace ya no es válido.' : null;
  const sent = `Enviada ${relativeTimeLabel(member.invitation.sentAt).toLocaleLowerCase('es-MX')}`;
  return member.state === 'invitation_expired' ? `${sent} · venció el ${formatDateTime(member.invitation.expiresAt)}` : `${sent} · vence el ${formatDateTime(member.invitation.expiresAt)}`;
}

export default function StaffTeamPanel() {
  const { showToast } = usePrivateToast();
  const searchParams = useSearchParams();
  const [view, setView, viewHydrated] = usePersistentState<TeamView>('ocpool.staff.team.view', 'active');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [data, setData] = useState<TeamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<'ok' | 'denied' | 'forbidden'>('ok');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('member'));
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [colleagues, setColleagues] = useState<TeamMember[]>([]);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  // En pantallas angostas la ficha queda debajo de la lista: al elegir a alguien se lleva la vista a ella.
  const detailRef = useRef<HTMLElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view });
      if (appliedSearch) params.set('query', appliedSearch);
      const response = await fetch(`/api/staff/team?${params.toString()}`, { credentials: 'include', cache: 'no-store', signal });
      if (response.status === 401) { setAccess('denied'); return; }
      if (response.status === 403) { setAccess('forbidden'); return; }
      const result = await readApiResponse<TeamResponse>(response, 'No fue posible cargar el equipo.');
      if (!result.ok) { setError(result.message); return; }
      setAccess('ok');
      setData(result.data);
      setSelectedId((current) => current && result.data.items.some((member) => member.id === current) ? current : result.data.items[0]?.id ?? null);
    } catch (caught) {
      if (signal?.aborted) return;
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el equipo.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [appliedSearch, view]);

  useEffect(() => {
    if (!viewHydrated) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey, viewHydrated]);

  // La persona abierta vive en la URL (?member=): recargar o compartir el enlace la conserva.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set('member', selectedId); else url.searchParams.delete('member');
    window.history.replaceState(null, '', url);
  }, [selectedId]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const selected = items.find((member) => member.id === selectedId) ?? null;
  const activeCount = data?.counts.active ?? 0;

  const refresh = async (message: string, options: { focusId?: string; view?: TeamView } = {}) => {
    showToast(message);
    if (options.focusId) setSelectedId(options.focusId);
    if (options.view && options.view !== view) { setView(options.view); return; }
    setReloadKey((current) => current + 1);
  };

  const openSuspend = async () => {
    if (!selected) return;
    setColleagues([]);
    setSuspendOpen(true);
    try {
      const response = await fetch('/api/staff/team?view=active', { credentials: 'include', cache: 'no-store' });
      const result = await readApiResponseOrThrow<TeamResponse>(response, 'No fue posible cargar al equipo activo.');
      setColleagues(result.items.filter((member) => member.id !== selected.id));
    } catch {
      setColleagues([]);
    }
  };

  const runConfirm = async () => {
    if (!selected || !confirm) return;
    const base = `/api/staff/team/${encodeURIComponent(selected.id)}`;
    const request = confirm === 'resend' ? { url: `${base}/invitation`, method: 'POST' }
      : confirm === 'cancel' ? { url: `${base}/invitation`, method: 'DELETE' }
        : confirm === 'reset' ? { url: `${base}/password-reset`, method: 'POST' }
          : confirm === 'sessions' ? { url: `${base}/sessions`, method: 'DELETE' }
            : { url: `${base}/reactivate`, method: 'POST' };
    const response = await fetch(request.url, { method: request.method, credentials: 'include', headers: { 'content-type': 'application/json' }, ...(request.method === 'POST' ? { body: '{}' } : {}) });
    const result = await readApiResponseOrThrow<{ sessionsRevoked?: number; status?: string }>(response, 'No fue posible completar la acción.');
    setConfirm(null);
    if (confirm === 'resend') await refresh(`Invitación reenviada a ${selected.email}. El enlace anterior ya no funciona.`);
    else if (confirm === 'cancel') await refresh(`Invitación de ${selected.displayName} cancelada.`);
    else if (confirm === 'reset') await refresh(`Enviamos a ${selected.email} un enlace para crear una nueva contraseña.`);
    else if (confirm === 'sessions') await refresh(result.sessionsRevoked ? `Cerramos ${plural(result.sessionsRevoked, 'sesión abierta', 'sesiones abiertas')} de ${selected.displayName}.` : `${selected.displayName} no tenía sesiones abiertas.`);
    else await refresh(result.status === 'INVITED' ? `${selected.displayName} vuelve a estar invitada: le enviamos un nuevo enlace.` : `Acceso de ${selected.displayName} reactivado.`, { view: result.status === 'INVITED' ? 'invited' : 'active' });
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedSearch(searchInput.trim());
  };

  if (access === 'denied') {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>Inicia sesión con una cuenta de empleado autorizada.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const confirmCopy: Record<ConfirmKind, { title: string; body: string; label: string; busy: string; tone?: 'danger' }> | null = selected ? {
    resend: { title: 'Reenviar invitación', body: `Enviaremos a ${selected.email} un nuevo enlace para crear su contraseña (vence en 72 horas). El enlace anterior deja de funcionar.`, label: 'Reenviar invitación', busy: 'Enviando…' },
    cancel: { title: 'Cancelar invitación', body: `El enlace de ${selected.displayName} dejará de funcionar y no podrá crear su contraseña. Podrás volver a invitarla después.`, label: 'Cancelar invitación', busy: 'Cancelando…', tone: 'danger' },
    reset: { title: 'Enviar enlace para nueva contraseña', body: `Enviaremos a ${selected.email} un enlace de un solo uso para crear una nueva contraseña. Su contraseña actual sigue funcionando hasta que la cambie.`, label: 'Enviar enlace', busy: 'Enviando…' },
    sessions: { title: 'Cerrar sus sesiones abiertas', body: `${selected.displayName} tendrá que volver a iniciar sesión en todos sus equipos. Útil si perdió un equipo o dejó una sesión abierta en otro lugar.`, label: 'Cerrar sesiones', busy: 'Cerrando…', tone: 'danger' },
    reactivate: { title: 'Reactivar acceso', body: `${selected.displayName} podrá volver a entrar con su contraseña. Si nunca la creó, le enviaremos una nueva invitación.`, label: 'Reactivar acceso', busy: 'Reactivando…' },
  } : null;

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />
      <div className="staff-content">
        <div className="staff-intro">
          <div><p className="staff-kicker">Administración</p><h1>Equipo</h1><p className="staff-intro__copy">Quién tiene acceso a OCPOOL, con qué rol y qué lleva a su cargo. Invita, cambia roles y suspende accesos sin que el trabajo se quede detenido.</p></div>
          {access === 'ok' && <div className="staff-intro__side">
            <button className="staff-button staff-button--dark staff-intro__create" type="button" onClick={() => setInviteOpen(true)}><Plus size={16} aria-hidden="true" />Invitar persona</button>
            <div className="staff-intro__metric"><strong>{loading && !data ? '—' : activeCount}</strong><span>{activeCount === 1 ? 'persona activa' : 'personas activas'}</span></div>
          </div>}
        </div>

        {access === 'forbidden' ? <PrivateBlockingState title="Tu rol no administra el equipo." action={<PrivateLinkButton href="/staff">Volver al dashboard</PrivateLinkButton>}>Pide a gerencia que invite, cambie roles o suspenda accesos.</PrivateBlockingState> : <>
          {error && <p className="staff-error" role="alert">{error} <button type="button" className="quotes-retry-link" onClick={() => setReloadKey((current) => current + 1)}>Reintentar</button></p>}

          <section className="team-board" aria-label="Equipo">
            <div className="team-board__list">
              <form className="projects-board__toolbar team-board__toolbar" onSubmit={submitSearch} role="search" aria-label="Filtrar equipo">
                <div className="staff-views team-board__views" role="group" aria-label="Estado de acceso">{TEAM_VIEWS.map((option) => <button key={option} type="button" className={view === option ? 'is-selected' : undefined} aria-pressed={view === option} onClick={() => { if (option !== view) setView(option); }}>{VIEW_LABELS[option]}{data ? <span className="team-board__count">{data.counts[option]}</span> : null}</button>)}</div>
                <label className="projects-board__search"><span className="sr-only">Buscar persona</span><span className="staff-search"><input aria-label="Buscar persona" value={searchInput} onChange={(event) => { setSearchInput(event.target.value); if (!event.target.value) setAppliedSearch(''); }} placeholder="Nombre o correo" maxLength={120} /></span></label>
              </form>
              <div aria-live="polite">
                {loading && !data && <div className="staff-list-placeholder"><span /><span /><span /></div>}
                {!loading && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Users size={20} /></span>
                  {appliedSearch
                    ? view !== 'all'
                      ? <><h2>Nadie coincide en {VIEW_LABELS[view].toLocaleLowerCase('es-MX')}.</h2><p>La misma búsqueda puede estar en otra vista.</p><button type="button" className="staff-button" onClick={() => setView('all')}>Buscar en todo el equipo</button></>
                      : <><h2>Nadie coincide con la búsqueda.</h2><p>Prueba con otro nombre o correo.</p><button type="button" className="staff-button" onClick={() => { setSearchInput(''); setAppliedSearch(''); }}>Limpiar búsqueda</button></>
                    : view === 'invited' ? <><h2>No hay invitaciones pendientes.</h2><p>Cuando invites a alguien, aparecerá aquí hasta que cree su contraseña.</p></>
                      : view === 'suspended' ? <><h2>No hay accesos suspendidos.</h2><p>Las personas suspendidas se conservan aquí con su historial y se pueden reactivar.</p></>
                        : <><h2>Aún no hay personas en esta vista.</h2><p>Invita a tu equipo para que pueda entrar a OCPOOL.</p></>}
                </div>}
                {items.length > 0 && <ul className="team-list">{items.map((member) => <li key={member.id}>
                  <button type="button" className={`team-row${member.id === selectedId ? ' is-selected' : ''}`} aria-current={member.id === selectedId ? 'true' : undefined} onClick={() => { setSelectedId(member.id); window.requestAnimationFrame(() => revealWhenStacked(detailRef.current, '(max-width: 1100px)')); }}>
                    <span className={`team-avatar team-avatar--${member.roleKey ?? 'none'}`} aria-hidden="true">{initialsOf(member.displayName)}</span>
                    <span className="team-row__identity"><strong>{member.displayName}{member.lock === 'self' ? <em className="team-row__you">Tú</em> : null}</strong><small>{member.email}</small></span>
                    <span className="team-row__meta"><span className={`team-state team-state--${member.state}`}>{TEAM_MEMBER_STATE_LABELS[member.state]}</span><small>{member.roleLabel ?? 'Sin rol'} · {workloadLabel(member)}</small></span>
                    <ChevronRight className="team-row__go" size={18} aria-hidden="true" />
                  </button>
                </li>)}</ul>}
              </div>
            </div>

            <aside className="team-detail" aria-label="Detalle de la persona" ref={detailRef}>
              {!selected ? <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><UserRound size={20} /></span><h2>Elige a una persona.</h2><p>Aquí verás su rol, su acceso y lo que lleva a su cargo.</p></div> : <>
                <div className="team-detail__head">
                  <span className={`team-avatar team-avatar--lg team-avatar--${selected.roleKey ?? 'none'}`} aria-hidden="true">{initialsOf(selected.displayName)}</span>
                  <div><p className="staff-section-label">{selected.roleLabel ?? 'Sin rol'}</p><h2>{selected.displayName}</h2><a href={`mailto:${selected.email}`}>{selected.email}</a></div>
                  <span className={`team-state team-state--${selected.state}`}>{TEAM_MEMBER_STATE_LABELS[selected.state]}</span>
                </div>
                {selected.lock && <p className="team-lock"><Lock size={15} aria-hidden="true" />{TEAM_MEMBER_LOCK_MESSAGES[selected.lock]}</p>}

                <section className="team-detail__section" aria-labelledby="team-role-heading">
                  <div className="team-detail__section-head"><h3 id="team-role-heading">Rol</h3>{!selected.lock && selected.status !== 'DISABLED' && <button type="button" className="staff-button staff-button--outline" onClick={() => setRoleOpen(true)}>Cambiar rol</button>}</div>
                  <p className="team-detail__text">{selected.roleKey ? TEAM_ROLE_DESCRIPTIONS[selected.roleKey] : 'Sin rol asignado: no puede usar ninguna sección.'}</p>
                </section>

                <section className="team-detail__section" aria-labelledby="team-access-heading">
                  <h3 id="team-access-heading">Acceso</h3>
                  <dl className="team-facts">
                    <div><dt>Último acceso</dt><dd>{selected.lastSignInAt ? <time dateTime={selected.lastSignInAt} title={formatDateTime(selected.lastSignInAt)}>{relativeTimeLabel(selected.lastSignInAt)}</time> : selected.state === 'invited' || selected.state === 'invitation_expired' ? 'Aún no crea su contraseña' : 'Nunca ha entrado'}</dd></div>
                    <div><dt>Sesiones abiertas</dt><dd>{selected.activeSessions}</dd></div>
                    <div><dt>Verificación en dos pasos</dt><dd className={selected.mfaEnabled ? 'is-on' : undefined}>{selected.mfaEnabled ? <><ShieldCheck size={14} aria-hidden="true" />Activa</> : 'No activada'}</dd></div>
                    {invitationLabel(selected) && <div className="team-facts__wide"><dt>Invitación</dt><dd>{invitationLabel(selected)}</dd></div>}
                  </dl>
                </section>

                <section className="team-detail__section" aria-labelledby="team-work-heading">
                  <h3 id="team-work-heading">Trabajo a su cargo</h3>
                  <p className="team-detail__text">{selected.openRequests || selected.projectsInTransition
                    ? `${[selected.openRequests ? plural(selected.openRequests, 'expediente abierto', 'expedientes abiertos') : null, selected.projectsInTransition ? plural(selected.projectsInTransition, 'proyecto en arranque', 'proyectos en arranque') : null].filter(Boolean).join(' y ')}.`
                    : selected.state === 'suspended' ? 'Nada pendiente: su trabajo se reasignó al suspender el acceso.' : 'No tiene expedientes abiertos ni proyectos en arranque.'}</p>
                </section>

                {!selected.lock && <div className="team-detail__actions">
                  {selected.state === 'active' && <>
                    <button type="button" className="staff-button staff-button--outline" onClick={() => setConfirm('reset')}><KeyRound size={15} aria-hidden="true" />Enviar enlace para nueva contraseña</button>
                    <button type="button" className="staff-button staff-button--outline" disabled={selected.activeSessions === 0} onClick={() => setConfirm('sessions')}>{selected.activeSessions ? `Cerrar ${plural(selected.activeSessions, 'sesión abierta', 'sesiones abiertas')}` : 'Sin sesiones abiertas'}</button>
                    <button type="button" className="staff-button staff-button--quiet-danger" onClick={() => void openSuspend()}>Suspender acceso</button>
                  </>}
                  {(selected.state === 'invited' || selected.state === 'invitation_expired') && <>
                    <button type="button" className={`staff-button ${selected.state === 'invitation_expired' ? 'staff-button--dark' : 'staff-button--outline'}`} onClick={() => setConfirm('resend')}>Reenviar invitación</button>
                    <button type="button" className="staff-button staff-button--quiet-danger" onClick={() => setConfirm('cancel')}>Cancelar invitación</button>
                  </>}
                  {selected.state === 'suspended' && <button type="button" className="staff-button staff-button--dark" onClick={() => setConfirm('reactivate')}>Reactivar acceso</button>}
                </div>}
                <p className="team-detail__since">En OCPOOL desde el {formatDate(selected.createdAt)}.</p>
              </>}
            </aside>
          </section>
        </>}
      </div>

      <InviteMemberDialog open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={async (message, memberId) => { setInviteOpen(false); await refresh(message, { focusId: memberId, view: 'invited' }); }} />
      <ChangeRoleDialog open={roleOpen} member={selected} onClose={() => setRoleOpen(false)} onChanged={async (message) => { setRoleOpen(false); await refresh(message); }} />
      <SuspendMemberDialog open={suspendOpen} member={selected} colleagues={colleagues} onClose={() => setSuspendOpen(false)} onSuspended={async (message) => { setSuspendOpen(false); await refresh(message, { view: 'suspended' }); }} />
      {confirm && confirmCopy && <ConfirmMemberDialog open title={confirmCopy[confirm].title} body={confirmCopy[confirm].body} confirmLabel={confirmCopy[confirm].label} busyLabel={confirmCopy[confirm].busy} tone={confirmCopy[confirm].tone} onConfirm={runConfirm} onClose={() => setConfirm(null)} />}
    </PrivateSurfaceRoot>
  );
}
