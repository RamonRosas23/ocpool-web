'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Eye, EyeOff, KeyRound, Monitor, MonitorSmartphone, ShieldAlert, ShieldCheck, Smartphone, Tablet, type LucideIcon } from 'lucide-react';
import StaffHeader from '@/components/StaffHeader';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton } from '@/components/private/ui';
import { usePrivateToast } from '@/components/private/ui/PrivateToast';
import AccountMfaSection, { type AccountSecurity } from '@/components/staff/AccountMfaSection';
import { ConfirmMemberDialog } from '@/components/staff/TeamMemberDialogs';
import { accountActivityLabel } from '@/lib/account-activity';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { meetsPasswordPolicy, passwordChecks } from '@/lib/password-checks';
import { relativeTimeLabel } from '@/lib/relative-time';
import { describeUserAgent, type DeviceKind } from '@/lib/user-agent-label';
import { TEAM_ROLE_DESCRIPTIONS, type TeamRoleKey } from '@/server/modules/team/domain';

type AccountOverview = {
  profile: { displayName: string; email: string; roleKey: TeamRoleKey | null; roleLabel: string | null; createdAt: string };
  security: AccountSecurity;
  sessions: Array<{ id: string; current: boolean; userAgent: string | null; ipAddress: string | null; createdAt: string; lastSeenAt: string }>;
  activity: Array<{ id: string; eventType: string; outcome: string; origin: string | null; createdAt: string; ipAddress: string | null; userAgent: string | null }>;
};

const JSON_HEADERS = { 'content-type': 'application/json' };
// Los errores que la persona corrige (contraseña o código incorrecto) se muestran sin referencia de soporte.
const PLAIN_ERRORS = { plainClientErrors: true } as const;
const DEVICE_ICONS: Record<DeviceKind, LucideIcon> = { phone: Smartphone, tablet: Tablet, computer: Monitor, unknown: MonitorSmartphone };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toLocaleUpperCase('es-MX');
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export default function StaffAccountPanel() {
  const router = useRouter();
  const { showToast } = usePrivateToast();
  const [data, setData] = useState<AccountOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<'ok' | 'denied' | 'forbidden'>('ok');
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/account', { credentials: 'include', cache: 'no-store', signal });
      if (response.status === 401) { setAccess('denied'); return; }
      if (response.status === 403) { setAccess('forbidden'); return; }
      const result = await readApiResponse<AccountOverview>(response, 'No fue posible cargar tu cuenta.');
      if (!result.ok) { setError(result.message); return; }
      setAccess('ok');
      setData(result.data);
    } catch (caught) {
      if (signal?.aborted) return;
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar tu cuenta.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  const refresh = async (message: string) => {
    showToast(message);
    setReloadKey((current) => current + 1);
  };

  if (access === 'denied') {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>Inicia sesión con una cuenta de empleado autorizada.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const mfaEnabled = data?.security.mfaEnabled ?? false;

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />
      <div className="staff-content">
        <div className="staff-intro">
          <div><p className="staff-kicker">Tu cuenta</p><h1>Mi cuenta</h1><p className="staff-intro__copy">Tu nombre, tu contraseña y la seguridad de tu acceso. Revisa desde dónde está abierta tu cuenta y cierra lo que no reconozcas.</p></div>
          {data && <div className="staff-intro__side">
            <a href="#account-mfa" className={`account-posture${mfaEnabled ? ' is-protected' : ''}`}>
              <span className="account-posture__mark" aria-hidden="true">{mfaEnabled ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}</span>
              <span><strong>{mfaEnabled ? 'Cuenta protegida' : 'Protección básica'}</strong><small>{mfaEnabled ? 'Contraseña y código de tu teléfono' : 'Sólo contraseña · activa la verificación en dos pasos'}</small></span>
            </a>
          </div>}
        </div>

        {access === 'forbidden' ? <PrivateBlockingState title="Esta sección es para el equipo de OCPOOL." action={<PrivateLinkButton href="/portal">Ir a mi portal</PrivateLinkButton>}>Tu cuenta de cliente se administra desde el portal.</PrivateBlockingState> : <>
          {error && <p className="staff-error" role="alert">{error} <button type="button" className="quotes-retry-link" onClick={() => setReloadKey((current) => current + 1)}>Reintentar</button></p>}
          {loading && !data && <div className="account-layout" aria-busy="true"><div className="account-card"><div className="staff-list-placeholder"><span /><span /><span /></div></div></div>}
          {data && <div className="account-layout">
            <div className="account-layout__main">
              <ProfileCard profile={data.profile} onRenamed={async (displayName) => { showToast(`Listo: ahora apareces como ${displayName}.`); router.refresh(); setReloadKey((current) => current + 1); }} />
              <PasswordCard email={data.profile.email} onChanged={(otherSessionsRevoked) => refresh(`Contraseña actualizada.${otherSessionsRevoked ? ` Cerramos ${plural(otherSessionsRevoked, 'sesión', 'sesiones')} en otros equipos.` : ''}`)} />
              <AccountMfaSection security={data.security} onChanged={refresh} />
              <SessionsCard sessions={data.sessions} onChanged={refresh} />
            </div>
            <aside className="account-layout__aside">
              <ActivityCard activity={data.activity} />
            </aside>
          </div>}
        </>}
      </div>
    </PrivateSurfaceRoot>
  );
}

function ProfileCard({ profile, onRenamed }: { profile: AccountOverview['profile']; onRenamed: (displayName: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);

  // Al abrir, el nombre queda seleccionado; al cerrar (o guardar), el foco vuelve a "Editar nombre".
  useEffect(() => {
    if (editing) { nameRef.current?.select(); return; }
    if (returnFocusRef.current) {
      returnFocusRef.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  const openEditor = () => {
    setDraft(profile.displayName);
    setError(null);
    setEditing(true);
  };

  const close = () => {
    returnFocusRef.current = true;
    setEditing(false);
    setError(null);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = draft.trim().replace(/\s+/gu, ' ');
    if (displayName.length < 2) { setError('Escribe tu nombre completo.'); return; }
    if (displayName === profile.displayName) { close(); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/account', { method: 'PATCH', credentials: 'include', headers: JSON_HEADERS, body: JSON.stringify({ displayName }) });
      const result = await readApiResponseOrThrow<{ displayName: string }>(response, 'No fue posible guardar tu nombre.', PLAIN_ERRORS);
      returnFocusRef.current = true;
      setEditing(false);
      await onRenamed(result.displayName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar tu nombre.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="account-card" id="account-profile" aria-labelledby="account-profile-heading">
    <div className="account-card__head"><div><h2 id="account-profile-heading">Perfil</h2><p>Así te ven tus compañeros y los clientes en la conversación.</p></div></div>
    <div className="account-profile">
      <span className={`team-avatar team-avatar--lg team-avatar--${profile.roleKey ?? 'none'}`} aria-hidden="true">{initialsOf(editing ? draft || profile.displayName : profile.displayName)}</span>
      {editing ? <form className="account-profile__form" onSubmit={(event) => void save(event)} noValidate>
        <label className="quotes-preflight-field"><span>Nombre completo</span><input ref={nameRef} value={draft} onChange={(event) => { setDraft(event.target.value); if (error) setError(null); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); } }} autoComplete="name" maxLength={180} required aria-invalid={error ? true : undefined} /></label>
        {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
        <div className="account-card__actions"><button type="button" className="staff-button staff-button--outline" onClick={close} disabled={busy}>Cancelar</button><button type="submit" className="staff-button staff-button--dark" disabled={busy}>{busy ? 'Guardando…' : 'Guardar nombre'}</button></div>
      </form> : <>
        <div className="account-profile__identity"><strong>{profile.displayName}</strong><span>{profile.email}</span></div>
        <button ref={editRef} type="button" className="staff-button staff-button--outline" onClick={openEditor}>Editar nombre</button>
      </>}
    </div>
    <dl className="team-facts account-profile__facts">
      <div><dt>Rol</dt><dd>{profile.roleLabel ?? 'Sin rol'}</dd></div>
      <div><dt>En OCPOOL desde</dt><dd>{formatDate(profile.createdAt)}</dd></div>
    </dl>
    <p className="account-card__hint">{profile.roleKey ? TEAM_ROLE_DESCRIPTIONS[profile.roleKey] : 'Aún no tienes un rol asignado: pide a gerencia que te asigne uno.'} Tu correo es tu usuario para entrar y donde recibes los avisos.</p>
  </section>;
}

function PasswordCard({ email, onChanged }: { email: string; onChanged: (otherSessionsRevoked: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);

  useEffect(() => {
    if (open) { currentRef.current?.focus(); return; }
    if (returnFocusRef.current) {
      returnFocusRef.current = false;
      toggleRef.current?.focus();
    }
  }, [open]);

  const reset = () => {
    setCurrent('');
    setPassword('');
    setConfirmation('');
    setVisible(false);
    setError(null);
  };

  const openForm = () => {
    reset();
    setOpen(true);
  };

  const close = () => {
    reset();
    returnFocusRef.current = true;
    setOpen(false);
  };

  const checks = [
    ...passwordChecks(password, confirmation),
    { key: 'different', label: 'Distinta de la actual', met: password.length > 0 && password !== current },
  ];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!current) { setError('Escribe tu contraseña actual.'); currentRef.current?.focus(); return; }
    if (!meetsPasswordPolicy(password)) { setError('La nueva contraseña necesita al menos 12 caracteres, con letras y números.'); return; }
    if (password !== confirmation) { setError('Las contraseñas nuevas no coinciden.'); return; }
    if (password === current) { setError('La nueva contraseña debe ser distinta de la actual.'); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/account/password', { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: JSON.stringify({ currentPassword: current, newPassword: password }) });
      const result = await readApiResponseOrThrow<{ otherSessionsRevoked: number }>(response, 'No fue posible cambiar tu contraseña.', PLAIN_ERRORS);
      reset();
      returnFocusRef.current = true;
      setOpen(false);
      await onChanged(result.otherSessionsRevoked);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar tu contraseña.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="account-card" id="account-password" aria-labelledby="account-password-heading">
    <div className="account-card__head"><div><h2 id="account-password-heading">Contraseña</h2><p>Cámbiala cuando quieras; sólo necesitas la actual.</p></div><span className="account-card__icon" aria-hidden="true"><KeyRound size={18} /></span></div>
    {!open ? <>
      <p className="account-card__text">Al cambiarla cerramos tu cuenta en los demás equipos; en éste sigues dentro.</p>
      <div className="account-card__actions account-card__actions--split">
        <button ref={toggleRef} type="button" className="staff-button staff-button--outline" onClick={openForm}>Cambiar contraseña</button>
        <Link className="account-link" href="/login/recovery">¿No recuerdas la actual?</Link>
      </div>
    </> : <form className="account-password" onSubmit={(event) => void submit(event)} noValidate>
      <input hidden type="text" name="username" autoComplete="username" value={email} readOnly />
      <label className="quotes-preflight-field"><span>Contraseña actual</span><input ref={currentRef} type={visible ? 'text' : 'password'} name="current-password" value={current} onChange={(event) => { setCurrent(event.target.value); if (error) setError(null); }} autoComplete="current-password" maxLength={128} required /></label>
      <div className="account-password__pair">
        <label className="quotes-preflight-field"><span>Nueva contraseña</span><input type={visible ? 'text' : 'password'} name="new-password" value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(null); }} autoComplete="new-password" minLength={12} maxLength={128} required aria-describedby="account-password-requirements" /></label>
        <label className="quotes-preflight-field"><span>Confirmar nueva contraseña</span><input type={visible ? 'text' : 'password'} name="confirm-password" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); if (error) setError(null); }} autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      </div>
      <div className="auth-requirements account-password__requirements">
        <ul id="account-password-requirements" aria-label="Requisitos de la nueva contraseña">{checks.map((check) => <li key={check.key} className={check.met ? 'is-met' : undefined}><span className="auth-requirements__mark" aria-hidden="true">{check.met ? <Check size={12} strokeWidth={3} /> : null}</span>{check.label}<span className="sr-only">{check.met ? ' (cumplido)' : ' (pendiente)'}</span></li>)}</ul>
        <button className="auth-text-button" type="button" aria-pressed={visible} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}{visible ? 'Ocultar' : 'Mostrar'}</button>
      </div>
      {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
      <div className="account-card__actions"><button type="button" className="staff-button staff-button--outline" onClick={close} disabled={busy}>Cancelar</button><button type="submit" className="staff-button staff-button--dark" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button></div>
    </form>}
  </section>;
}

function SessionsCard({ sessions, onChanged }: { sessions: AccountOverview['sessions']; onChanged: (message: string) => Promise<void> }) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingRef = useRef(false);
  const others = sessions.filter((session) => !session.current).length;

  // El botón de la sesión cerrada desaparece con la recarga: el foco pasa al título de la sección.
  useEffect(() => {
    if (!focusHeadingRef.current) return;
    focusHeadingRef.current = false;
    headingRef.current?.focus();
  }, [sessions]);

  const closeOne = async (sessionId: string, label: string) => {
    setClosingId(sessionId);
    setError(null);
    try {
      const response = await fetch(`/api/staff/account/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', credentials: 'include', headers: JSON_HEADERS });
      await readApiResponseOrThrow<{ revoked: number }>(response, 'No fue posible cerrar la sesión.', PLAIN_ERRORS);
      focusHeadingRef.current = true;
      await onChanged(`Cerramos tu sesión en ${label}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cerrar la sesión.');
    } finally {
      setClosingId(null);
    }
  };

  const closeOthers = async () => {
    const response = await fetch('/api/staff/account/sessions', { method: 'DELETE', credentials: 'include', headers: JSON_HEADERS });
    const result = await readApiResponseOrThrow<{ revoked: number }>(response, 'No fue posible cerrar las demás sesiones.', PLAIN_ERRORS);
    focusHeadingRef.current = true;
    setConfirmOthers(false);
    await onChanged(result.revoked ? `Cerramos ${plural(result.revoked, 'sesión', 'sesiones')} en otros equipos.` : 'No había otras sesiones abiertas.');
  };

  return <section className="account-card" id="account-sessions" aria-labelledby="account-sessions-heading">
    <div className="account-card__head">
      <div><h2 id="account-sessions-heading" ref={headingRef} tabIndex={-1}>Sesiones abiertas</h2><p>Equipos donde tu cuenta está abierta ahora mismo.</p></div>
      {others > 0 && <button type="button" className="staff-button staff-button--outline" onClick={() => setConfirmOthers(true)}>Cerrar las demás</button>}
    </div>
    {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
    <ul className="account-sessions">
      {sessions.map((session) => {
        const device = describeUserAgent(session.userAgent);
        const Icon = DEVICE_ICONS[device.kind];
        return <li key={session.id} className={session.current ? 'is-current' : undefined}>
          <span className="account-sessions__icon" aria-hidden="true"><Icon size={18} /></span>
          <div className="account-sessions__body">
            <strong>{device.label}{session.current && <em className="account-sessions__this">Esta sesión</em>}</strong>
            <small>
              {session.current ? 'Estás aquí' : <>Activa <time dateTime={session.lastSeenAt} title={formatDateTime(session.lastSeenAt)}>{relativeTimeLabel(session.lastSeenAt).toLocaleLowerCase('es-MX')}</time></>}
              {session.ipAddress ? ` · IP ${session.ipAddress}` : ''}
              {` · Inició el ${formatDateTime(session.createdAt)}`}
            </small>
          </div>
          {!session.current && <button type="button" className="staff-button staff-button--quiet-danger account-sessions__close" disabled={closingId !== null} onClick={() => void closeOne(session.id, device.label)} aria-label={`Cerrar la sesión en ${device.label}`}>{closingId === session.id ? 'Cerrando…' : 'Cerrar'}</button>}
        </li>;
      })}
    </ul>
    <p className="account-card__hint">{others === 0 ? 'Sólo tienes abierta esta sesión; para cerrarla' : 'Si no reconoces un equipo, ciérralo y cambia tu contraseña. Para cerrar esta sesión'} usa «Cerrar sesión» en el menú de tu cuenta.</p>
    {confirmOthers && <ConfirmMemberDialog open title="Cerrar las demás sesiones" body={`Tu cuenta se cerrará en ${plural(others, 'otro equipo', 'otros equipos')}; ahí tendrás que volver a iniciar sesión. En éste sigues dentro.`} confirmLabel="Cerrar las demás" busyLabel="Cerrando…" tone="danger" onConfirm={closeOthers} onClose={() => setConfirmOthers(false)} />}
  </section>;
}

function ActivityCard({ activity }: { activity: AccountOverview['activity'] }) {
  return <section className="account-card account-activity" id="account-activity" aria-labelledby="account-activity-heading">
    <div className="account-card__head"><div><h2 id="account-activity-heading">Actividad reciente</h2><p>Accesos y cambios de seguridad de tu cuenta.</p></div></div>
    {activity.length === 0 ? <p className="account-card__text">Aún no hay actividad registrada.</p> : <ol className="account-activity__list">
      {activity.map((event) => {
        const { label, tone } = accountActivityLabel(event);
        const device = event.userAgent ? describeUserAgent(event.userAgent).label : null;
        return <li key={event.id} className={`is-${tone}`}>
          <span className="account-activity__dot" aria-hidden="true" />
          <div><strong>{label}</strong><small><time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>{relativeTimeLabel(event.createdAt)}</time>{device ? ` · ${device}` : ''}{event.ipAddress ? ` · IP ${event.ipAddress}` : ''}</small></div>
        </li>;
      })}
    </ol>}
    <p className="account-card__hint">¿Algo que no reconoces? <a href="#account-password">Cambia tu contraseña</a> y <a href="#account-sessions">cierra las demás sesiones</a>.</p>
  </section>;
}
