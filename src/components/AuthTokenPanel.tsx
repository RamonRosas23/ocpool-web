'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';

type TokenKind = 'customer' | 'recovery';
type TokenState = 'loading' | 'missing' | 'invalid' | 'ready' | 'success';
type ErrorResponse = { error?: { message?: string } };

async function publicError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as ErrorResponse;
  return body.error?.message ? 'El enlace no es válido o ya expiró.' : 'El enlace no es válido o ya expiró.';
}

function removeTokenFromAddress() {
  const current = new URL(window.location.href);
  current.searchParams.delete('token');
  window.history.replaceState({}, '', `${current.pathname}${current.search}${current.hash}`);
}

export default function AuthTokenPanel({ kind }: { kind: TokenKind }) {
  const customer = kind === 'customer';
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<TokenState>('loading');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const rawToken = new URL(window.location.href).searchParams.get('token');
    removeTokenFromAddress();
    if (!rawToken) {
      setState('missing');
      return;
    }
    setToken(rawToken);
    if (!customer) {
      setState('ready');
      return;
    }

    void fetch('/api/auth/customer/consume-link', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(await publicError(response));
      setState('success');
      window.location.replace('/portal');
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'El enlace no es válido o ya expiró.');
      setState('invalid');
    });
  }, [customer]);

  const submitRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || busy) return;
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/recovery/consume', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!response.ok) throw new Error(await publicError(response));
      setState('success');
      setToken(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'El enlace no es válido o ya expiró.');
    } finally {
      setBusy(false);
    }
  };

  const invalid = state === 'missing' || state === 'invalid';
  const success = state === 'success';

  return <main className="auth-shell auth-shell--token">
    <section className="auth-context" aria-label="Contexto de acceso">
      <Link className="auth-brand" href="/" aria-label="OCPOOL, volver al sitio público"><span>OCPOOL</span><small>{customer ? 'Portal de cliente' : 'Acceso interno'}</small></Link>
      <div className="auth-context__copy"><p className="auth-kicker">{customer ? 'Acceso privado' : 'Seguridad de cuenta'}</p><h1>{customer ? <>Tu expediente, cuando lo <em>necesites.</em></> : <>Recupera el control de tu <em>cuenta.</em></>}</h1><p>{customer ? 'Estamos validando la entrada a tu espacio privado.' : 'Elige una nueva contraseña para volver a trabajar con seguridad.'}</p></div>
      <div className="auth-context__footer"><span>Enlace de un solo uso</span><small>Protegido por sesión privada</small></div>
    </section>

    <section className="auth-panel" aria-labelledby="auth-token-title">
      <div className="auth-panel__top"><p className="auth-kicker">{customer ? 'Portal de cliente' : 'Recuperación'}</p><Link href={customer ? '/portal/access' : '/login'} className="auth-panel__back">Volver al acceso</Link></div>
      <div className="auth-panel__body">
        {customer && state === 'loading' && <><h2 id="auth-token-title">Validando tu acceso</h2><p className="auth-panel__intro" role="status">Un momento. Estamos comprobando tu enlace.</p></>}
        {invalid && <><h2 id="auth-token-title">Enlace no disponible</h2><p className="auth-panel__intro" role="alert">{error ?? 'Este enlace no existe, ya fue utilizado o expiró.'}</p><Link className="auth-submit auth-submit--link" href={customer ? '/portal/access' : '/login/recovery'}>{customer ? 'Solicitar otro enlace' : 'Solicitar otro enlace'}</Link></>}
        {!customer && state === 'ready' && <><h2 id="auth-token-title">Define tu contraseña</h2><p className="auth-panel__intro">Usa al menos 12 caracteres con letras y números.</p><form className="auth-form" onSubmit={submitRecovery} noValidate><label><span>Nueva contraseña</span><input type="password" name="newPassword" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label><label><span>Confirmar contraseña</span><input type="password" name="confirmation" autoComplete="new-password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}<button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Actualizando…' : 'Actualizar contraseña'}</button></form></>}
        {success && !customer && <><h2 id="auth-token-title">Acceso actualizado</h2><p className="auth-feedback auth-feedback--success" role="status">Tu contraseña fue actualizada. Ya puedes iniciar sesión con ella.</p><Link className="auth-submit auth-submit--link" href="/login">Ir al acceso</Link></>}
      </div>
      <p className="auth-panel__note">Nunca compartas un enlace de acceso. OCPOOL no te pedirá tu contraseña por correo.</p>
    </section>
  </main>;
}

