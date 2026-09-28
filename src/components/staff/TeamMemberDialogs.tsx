'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PrivateDialog, PrivateSelect } from '@/components/private/ui';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import { TEAM_ROLE_DESCRIPTIONS, TEAM_ROLE_LABELS, TEAM_ROLES, type TeamRole } from '@/server/modules/team/domain';

export type TeamMember = {
  id: string;
  displayName: string;
  email: string;
  status: string;
  state: 'active' | 'invited' | 'invitation_expired' | 'suspended';
  roleKey: 'sales' | 'manager' | 'admin' | null;
  roleLabel: string | null;
  mfaEnabled: boolean;
  lastSignInAt: string | null;
  activeSessions: number;
  openRequests: number;
  projectsInTransition: number;
  invitation: { sentAt: string; expiresAt: string } | null;
  createdAt: string;
  lock: 'self' | 'admin' | null;
};

const NO_HEIR = '__none__';

function RoleChoice({ name, value, onChange, disabled }: { name: string; value: TeamRole | ''; onChange: (role: TeamRole) => void; disabled?: boolean }) {
  return <fieldset className="team-role-choice" disabled={disabled}>
    <legend>Rol</legend>
    {TEAM_ROLES.map((role) => <label key={role} className={`team-role-choice__option${value === role ? ' is-selected' : ''}`}>
      <input type="radio" name={name} value={role} checked={value === role} onChange={() => onChange(role)} />
      <span><strong>{TEAM_ROLE_LABELS[role]}</strong><small>{TEAM_ROLE_DESCRIPTIONS[role]}</small></span>
    </label>)}
  </fieldset>;
}

function DialogHead({ id, title, onClose, busy }: { id: string; title: string; onClose: () => void; busy: boolean }) {
  return <div className="quotes-preflight-dialog__head"><h3 id={id}>{title}</h3><button className="staff-dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>;
}

/** Invitar: la persona recibe un correo para crear su contraseña; el enlace vence en 72 horas. */
export function InviteMemberDialog({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: (message: string, memberId: string) => Promise<void> }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole | ''>('sales');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDisplayName('');
    setEmail('');
    setRole('sales');
    setError(null);
  }, [open]);

  const submit = async () => {
    if (displayName.trim().length < 2) { setError('Escribe el nombre completo.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())) { setError('Escribe un correo válido.'); return; }
    if (!role) { setError('Elige el rol.'); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/team', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: displayName.trim(), email: email.trim(), role }) });
      const created = await readApiResponseOrThrow<{ id: string; displayName: string; email: string }>(response, 'No fue posible enviar la invitación.');
      await onInvited(`Invitación enviada a ${created.email}. El enlace vence en 72 horas.`, created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible enviar la invitación.');
    } finally {
      setBusy(false);
    }
  };

  return <PrivateDialog open={open} onClose={() => { if (!busy) onClose(); }} className="quotes-preflight-dialog team-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="team-invite-title" describedBy="team-invite-description" initialFocusRef={nameRef}>
    <DialogHead id="team-invite-title" title="Invitar persona" onClose={onClose} busy={busy} />
    <p id="team-invite-description" className="quotes-preflight-dialog__copy">Recibirá un correo para crear su contraseña. El enlace vence en 72 horas y, al usarlo, su cuenta queda activa.</p>
    <form className="team-dialog__fields" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
      <label className="quotes-preflight-field"><span>Nombre completo</span><input ref={nameRef} id="team-invite-name" value={displayName} onChange={(event) => { setDisplayName(event.target.value); if (error) setError(null); }} autoComplete="off" maxLength={180} required /></label>
      <label className="quotes-preflight-field"><span>Correo de trabajo</span><input id="team-invite-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(null); }} autoComplete="off" maxLength={320} required /></label>
      <RoleChoice name="team-invite-role" value={role} onChange={setRole} disabled={busy} />
      <p className="team-dialog__note">Las cuentas de administrador exigen verificación en dos pasos y se crean con el procedimiento seguro.</p>
      {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
      <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="staff-button staff-button--dark" type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar invitación'}</button></div>
    </form>
  </PrivateDialog>;
}

/** Cambiar entre Ventas y Gerencia: aplica de inmediato, sin cerrar su sesión. */
export function ChangeRoleDialog({ open, member, onClose, onChanged }: { open: boolean; member: TeamMember | null; onClose: () => void; onChanged: (message: string) => Promise<void> }) {
  const [role, setRole] = useState<TeamRole | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !member) return;
    setRole(member.roleKey === 'manager' || member.roleKey === 'sales' ? member.roleKey : '');
    setError(null);
  }, [open, member]);

  if (!member) return null;
  const submit = async () => {
    if (!role) { setError('Elige el rol.'); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/team/${encodeURIComponent(member.id)}/role`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) });
      const result = await readApiResponseOrThrow<{ changed: boolean }>(response, 'No fue posible cambiar el rol.');
      await onChanged(result.changed ? `${member.displayName} ahora tiene el rol de ${TEAM_ROLE_LABELS[role]}.` : `${member.displayName} ya tenía el rol de ${TEAM_ROLE_LABELS[role]}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar el rol.');
    } finally {
      setBusy(false);
    }
  };

  return <PrivateDialog open={open} onClose={() => { if (!busy) onClose(); }} className="quotes-preflight-dialog team-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="team-role-title" describedBy="team-role-description">
    <DialogHead id="team-role-title" title={`Rol de ${member.displayName}`} onClose={onClose} busy={busy} />
    <p id="team-role-description" className="quotes-preflight-dialog__copy">El cambio aplica de inmediato: no necesita volver a iniciar sesión.</p>
    <div className="team-dialog__fields"><RoleChoice name="team-role" value={role} onChange={setRole} disabled={busy} /></div>
    {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
    <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="staff-button staff-button--dark" type="button" disabled={busy || !role} onClick={() => void submit()}>{busy ? 'Guardando…' : 'Guardar rol'}</button></div>
  </PrivateDialog>;
}

/**
 * Suspender: sin acceso desde ese momento (sesiones cerradas, enlaces anulados). Su trabajo abierto no
 * se queda detenido: se elige a quién pasa, o queda sin responsable en "Sin asignar".
 */
export function SuspendMemberDialog({ open, member, colleagues, onClose, onSuspended }: { open: boolean; member: TeamMember | null; colleagues: readonly TeamMember[]; onClose: () => void; onSuspended: (message: string) => Promise<void> }) {
  const [heirId, setHeirId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setHeirId('');
    setReason('');
    setError(null);
  }, [open]);

  if (!member) return null;
  const workload = member.openRequests + member.projectsInTransition;
  const workloadText = [
    member.openRequests ? `${member.openRequests} ${member.openRequests === 1 ? 'expediente abierto' : 'expedientes abiertos'}` : null,
    member.projectsInTransition ? `${member.projectsInTransition} ${member.projectsInTransition === 1 ? 'proyecto en arranque' : 'proyectos en arranque'}` : null,
  ].filter(Boolean).join(' y ');
  const submit = async () => {
    if (workload > 0 && !heirId) { setError('Elige a quién pasa su trabajo (o déjalo sin responsable).'); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/team/${encodeURIComponent(member.id)}/suspend`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reassignToId: heirId && heirId !== NO_HEIR ? heirId : null, ...(reason.trim() ? { reason: reason.trim() } : {}) }) });
      const result = await readApiResponseOrThrow<{ requestsReassigned: number; projectsReassigned: number; reassignedTo: { displayName: string } | null }>(response, 'No fue posible suspender el acceso.');
      const moved = result.requestsReassigned + result.projectsReassigned;
      await onSuspended(moved === 0
        ? `Acceso de ${member.displayName} suspendido.`
        : result.reassignedTo
          ? `Acceso de ${member.displayName} suspendido. Su trabajo pasó a ${result.reassignedTo.displayName}.`
          : `Acceso de ${member.displayName} suspendido. Su trabajo quedó sin responsable, en "Sin asignar".`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible suspender el acceso.');
    } finally {
      setBusy(false);
    }
  };

  return <PrivateDialog open={open} onClose={() => { if (!busy) onClose(); }} className="quotes-preflight-dialog team-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="team-suspend-title" describedBy="team-suspend-description">
    <DialogHead id="team-suspend-title" title={`Suspender a ${member.displayName}`} onClose={onClose} busy={busy} />
    <p id="team-suspend-description" className="quotes-preflight-dialog__copy">No podrá entrar desde este momento: sus sesiones se cierran y sus enlaces pendientes dejan de funcionar. Su historial se conserva y puedes reactivarla cuando quieras.</p>
    {workload > 0
      ? <p className="staff-request-edit__impact is-sensitive">Tiene {workloadText} a su cargo. Elige quién {workload === 1 ? 'lo continúa' : 'los continúa'} para que nada se quede detenido.</p>
      : <p className="team-dialog__note">No tiene expedientes abiertos ni proyectos en arranque a su cargo.</p>}
    <div className="team-dialog__fields">
      {workload > 0 && <PrivateSelect id="team-suspend-heir" label="Pasar su trabajo a" required value={heirId} onValueChange={setHeirId} options={[...colleagues.map((colleague) => ({ value: colleague.id, label: `${colleague.displayName}${colleague.roleLabel ? ` · ${colleague.roleLabel}` : ''}` })), { value: NO_HEIR, label: 'Dejar sin responsable (quedan en "Sin asignar")' }]} placeholder="Elige a una persona" />}
      <label className="quotes-preflight-field"><span>Motivo (opcional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={2} placeholder="Por ejemplo: dejó la empresa; vacaciones prolongadas." /></label>
    </div>
    {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
    <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="staff-button staff-button--danger" type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Suspendiendo…' : 'Suspender acceso'}</button></div>
  </PrivateDialog>;
}

/** Confirmación breve para acciones de un paso (enlaces, sesiones, cancelar invitación). */
export function ConfirmMemberDialog({ open, title, body, confirmLabel, busyLabel, tone = 'dark', onConfirm, onClose }: { open: boolean; title: string; body: string; confirmLabel: string; busyLabel: string; tone?: 'dark' | 'danger'; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) setError(null); }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible completar la acción.');
    } finally {
      setBusy(false);
    }
  };

  return <PrivateDialog open={open} onClose={() => { if (!busy) onClose(); }} className="quotes-preflight-dialog team-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="team-confirm-title" describedBy="team-confirm-description">
    <DialogHead id="team-confirm-title" title={title} onClose={onClose} busy={busy} />
    <p id="team-confirm-description" className="quotes-preflight-dialog__copy">{body}</p>
    {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
    <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className={`staff-button ${tone === 'danger' ? 'staff-button--danger' : 'staff-button--dark'}`} type="button" disabled={busy} onClick={() => void confirm()}>{busy ? busyLabel : confirmLabel}</button></div>
  </PrivateDialog>;
}
