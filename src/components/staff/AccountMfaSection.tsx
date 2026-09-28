'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Copy, Lock, ShieldCheck, Smartphone, X } from 'lucide-react';
import { PrivateDialog } from '@/components/private/ui';
import TotpQrCode from '@/components/staff/TotpQrCode';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import { formatDate } from '@/lib/format-date';

export type AccountSecurity = { mfaEnabled: boolean; mfaEnrolledAt: string | null; mfaMandatory: boolean };
type Enrollment = { secret: string; uri: string; enrollmentToken: string; expiresAt: string };

const JSON_HEADERS = { 'content-type': 'application/json' };
// Los errores que la persona corrige (contraseña o código incorrecto) se muestran sin referencia de soporte.
const PLAIN_ERRORS = { plainClientErrors: true } as const;

function onlyDigits(value: string): string {
  return value.replace(/\D/gu, '').slice(0, 6);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Verificación en dos pasos desde la propia cuenta: se muestra la clave (QR y texto), la persona escribe
 * el primer código y sólo entonces se activa. Nada cambia en la cuenta hasta ese momento.
 */
export default function AccountMfaSection({ security, onChanged }: { security: AccountSecurity; onChanged: (message: string) => Promise<void> }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [expired, setExpired] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  // Tras confirmar, el estado "activa" llega con la recarga de la cuenta: mientras tanto el botón sigue ocupado.
  const [finishing, setFinishing] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const activateRef = useRef<HTMLButtonElement>(null);
  const focusHeadingRef = useRef(false);
  const returnToActivateRef = useRef(false);

  // Al cambiar de estado (activada o desactivada) el foco pasa al título de la sección, no se pierde.
  useEffect(() => {
    if (security.mfaEnabled) {
      setEnrollment(null);
      setFinishing(false);
    }
    if (focusHeadingRef.current) {
      focusHeadingRef.current = false;
      headingRef.current?.focus();
    }
  }, [security.mfaEnabled]);

  useEffect(() => {
    if (enrollment && !expired) {
      // El código queda listo para escribir, pero la vista muestra los pasos desde el primero (el QR va antes).
      codeRef.current?.focus({ preventScroll: true });
      sectionRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    if (!enrollment && returnToActivateRef.current) {
      returnToActivateRef.current = false;
      activateRef.current?.focus();
    }
  }, [enrollment, expired]);

  // La clave mostrada vale 15 minutos: al vencer se pide una nueva en lugar de dejar fallar el código.
  useEffect(() => {
    if (!enrollment) return;
    const remaining = new Date(enrollment.expiresAt).getTime() - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [enrollment]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/account/mfa?step=start', { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: '{}' });
      const next = await readApiResponseOrThrow<Enrollment>(response, 'No fue posible preparar la verificación.', PLAIN_ERRORS);
      setEnrollment(next);
      setExpired(false);
      setCode('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible preparar la verificación.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    returnToActivateRef.current = true;
    setEnrollment(null);
    setExpired(false);
    setCode('');
    setError(null);
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enrollment || busy || finishing) return;
    if (code.length !== 6) { setError('Escribe los 6 dígitos que muestra tu app.'); codeRef.current?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/account/mfa', { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: JSON.stringify({ enrollmentToken: enrollment.enrollmentToken, code }) });
      const result = await readApiResponseOrThrow<{ otherSessionsRevoked: number }>(response, 'No fue posible activar la verificación.', PLAIN_ERRORS);
      focusHeadingRef.current = true;
      setFinishing(true);
      await onChanged(`Verificación en dos pasos activada: desde ahora te pediremos un código al entrar.${result.otherSessionsRevoked ? ` Cerramos ${plural(result.otherSessionsRevoked, 'sesión', 'sesiones')} en otros equipos.` : ''}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible activar la verificación.');
      setCode('');
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const status = security.mfaEnabled
    ? <span className="account-pill account-pill--good"><ShieldCheck size={14} aria-hidden="true" />Activa</span>
    : <span className="account-pill account-pill--warn">No activada</span>;

  return <section className="account-card" id="account-mfa" aria-labelledby="account-mfa-heading" ref={sectionRef}>
    <div className="account-card__head">
      <div><h2 id="account-mfa-heading" ref={headingRef} tabIndex={-1}>Verificación en dos pasos</h2><p>Un código de tu teléfono además de la contraseña.</p></div>
      {status}
    </div>

    {security.mfaEnabled ? <>
      <p className="account-card__text">Activa desde el {formatDate(security.mfaEnrolledAt)}. Al entrar te pedimos el código de 6 dígitos de tu app de autenticación.</p>
      {security.mfaMandatory
        ? <p className="account-note"><Lock size={15} aria-hidden="true" />Para administradores es obligatoria: no se puede desactivar.</p>
        : <>
          <p className="account-card__hint">¿Cambias de teléfono? Desactívala aquí y vuelve a activarla con el nuevo. Si lo perdiste y no puedes entrar, gerencia puede quitarla desde Equipo.</p>
          <div className="account-card__actions"><button type="button" className="staff-button staff-button--quiet-danger" onClick={() => setDisableOpen(true)}>Desactivar</button></div>
        </>}
    </> : !enrollment ? <>
      <p className="account-card__text">Al entrar, además de tu contraseña, te pediremos un código de 6 dígitos que genera una app en tu teléfono. Aunque alguien llegue a conocer tu contraseña, sin tu teléfono no podrá entrar.</p>
      <p className="account-card__hint">Necesitas una app de autenticación: Google Authenticator, Microsoft Authenticator, 1Password o la que ya uses.</p>
      {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
      <div className="account-card__actions"><button ref={activateRef} type="button" className="staff-button staff-button--dark" disabled={busy} onClick={() => void start()}><ShieldCheck size={16} aria-hidden="true" />{busy ? 'Preparando…' : 'Activar verificación'}</button></div>
    </> : expired ? <div className="account-mfa__expired" role="alert">
      <p><strong>La clave venció.</strong> Por seguridad sólo vale 15 minutos y no se guardó nada en tu cuenta. Genera una nueva y escanéala otra vez (borra de tu app la que agregaste).</p>
      <div className="account-card__actions"><button type="button" className="staff-button staff-button--outline" onClick={cancel}>Cancelar</button><button type="button" className="staff-button staff-button--dark" disabled={busy} onClick={() => void start()}>{busy ? 'Preparando…' : 'Generar una clave nueva'}</button></div>
    </div> : <div className="account-mfa__setup">
      <ol className="account-mfa__steps">
        <li>
          <span className="account-mfa__step-mark" aria-hidden="true">1</span>
          <div><h3>Abre tu app de autenticación</h3><p>Elige agregar una cuenta; suele ser un botón «+».</p></div>
        </li>
        <li>
          <span className="account-mfa__step-mark" aria-hidden="true">2</span>
          <div className="account-mfa__scan">
            <h3>Escanea este código</h3>
            <div className="account-mfa__scan-body">
              <TotpQrCode value={enrollment.uri} label="Código QR para agregar OCPOOL a tu app de autenticación" />
              <div className="account-mfa__manual">
                <p>¿No puedes escanear? Escribe esta clave en la app:</p>
                <code className="account-mfa__secret">{enrollment.secret.match(/.{1,4}/gu)?.join(' ')}</code>
                <button type="button" className="staff-button staff-button--outline account-mfa__copy" onClick={() => void copySecret()}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Clave copiada' : 'Copiar clave'}</button>
                <a className="staff-button staff-button--outline account-mfa__open-app" href={enrollment.uri}><Smartphone size={15} aria-hidden="true" />Abrir en mi app</a>
              </div>
            </div>
          </div>
        </li>
        <li>
          <span className="account-mfa__step-mark" aria-hidden="true">3</span>
          <form className="account-mfa__confirm" onSubmit={(event) => void confirm(event)} noValidate>
            <h3><label htmlFor="account-mfa-code">Escribe el código que muestra la app para «OCPOOL»</label></h3>
            <div className="account-mfa__confirm-row">
              <input ref={codeRef} id="account-mfa-code" className="account-code-input" value={code} onChange={(event) => { setCode(onlyDigits(event.target.value)); if (error) setError(null); }} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} placeholder="000000" aria-describedby="account-mfa-note" aria-invalid={error ? true : undefined} />
              <button type="submit" className="staff-button staff-button--dark" disabled={busy || finishing}>{busy || finishing ? 'Activando…' : 'Activar'}</button>
            </div>
            {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
          </form>
        </li>
      </ol>
      <div className="account-mfa__footer">
        <p id="account-mfa-note">La clave vale 15 minutos y nada cambia hasta que confirmes el código. Al activarla cerramos tus sesiones en otros equipos; ésta sigue abierta.</p>
        <button type="button" className="staff-button staff-button--outline" onClick={cancel} disabled={busy || finishing}>Cancelar</button>
      </div>
    </div>}

    <DisableMfaDialog open={disableOpen} onClose={() => setDisableOpen(false)} onDisabled={async () => { focusHeadingRef.current = true; setDisableOpen(false); await onChanged('Verificación en dos pasos desactivada. Para entrar bastará tu contraseña.'); }} />
  </section>;
}

function DisableMfaDialog({ open, onClose, onDisabled }: { open: boolean; onClose: () => void; onDisabled: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setCode('');
    setError(null);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!password) { setError('Escribe tu contraseña actual.'); return; }
    if (code.length !== 6) { setError('Escribe los 6 dígitos que muestra tu app.'); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/account/mfa/disable', { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: JSON.stringify({ currentPassword: password, code }) });
      await readApiResponseOrThrow<{ enabled: boolean }>(response, 'No fue posible desactivar la verificación.', PLAIN_ERRORS);
      await onDisabled();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible desactivar la verificación.');
    } finally {
      setBusy(false);
    }
  };

  return <PrivateDialog open={open} onClose={() => { if (!busy) onClose(); }} className="quotes-preflight-dialog team-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="account-mfa-disable-title" describedBy="account-mfa-disable-description" initialFocusRef={passwordRef}>
    <div className="quotes-preflight-dialog__head"><h3 id="account-mfa-disable-title">Desactivar verificación en dos pasos</h3><button className="staff-dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
    <p id="account-mfa-disable-description" className="quotes-preflight-dialog__copy">Para confirmar que eres tú, escribe tu contraseña y el código actual de tu app. Después, para entrar bastará tu contraseña.</p>
    <form className="team-dialog__fields" onSubmit={(event) => void submit(event)} noValidate>
      <label className="quotes-preflight-field"><span>Contraseña actual</span><input ref={passwordRef} type="password" value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(null); }} autoComplete="current-password" maxLength={128} required /></label>
      <label className="quotes-preflight-field"><span>Código de 6 dígitos</span><input className="account-code-input account-code-input--compact" value={code} onChange={(event) => { setCode(onlyDigits(event.target.value)); if (error) setError(null); }} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} placeholder="000000" required /></label>
      {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
      <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="staff-button staff-button--danger" type="submit" disabled={busy}>{busy ? 'Desactivando…' : 'Desactivar'}</button></div>
    </form>
  </PrivateDialog>;
}
