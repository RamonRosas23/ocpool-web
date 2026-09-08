'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';

type SessionResponse = { type?: 'EMPLOYEE' | 'CUSTOMER' };
type ErrorResponse = { error?: { message?: string } };

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as ErrorResponse;
  if (response.status === 429) return 'El acceso está temporalmente limitado. Espera unos minutos y vuelve a intentarlo.';
  return body.error?.message ? 'No fue posible iniciar sesión. Verifica tus datos.' : 'No fue posible iniciar sesión. Verifica tus datos.';
}

export default function EmployeeLoginPanel() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as SessionResponse;
      })
      .then((session) => {
        if (!active || !session?.type) return;
        window.location.replace(session.type === 'EMPLOYEE' ? '/staff' : '/portal');
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/employee/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, ...(mfaCode ? { mfaCode } : {}) }),
      });
      if (!response.ok) throw new Error(await readError(response));
      window.location.assign('/staff');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible iniciar sesión. Verifica tus datos.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-shell auth-shell--staff">
    <section className="auth-context" aria-label="Contexto de acceso">
      <Link className="auth-brand" href="/" aria-label="OCPOOL, volver al sitio público"><span>OCPOOL</span><small>Operaciones comerciales</small></Link>
      <div className="auth-context__copy"><p className="auth-kicker">Espacios que toman forma</p><h1>La operación también merece <em>intención.</em></h1><p>Un espacio de trabajo para dar seguimiento a cada solicitud, cada conversación y cada propuesta con claridad.</p></div>
      <div className="auth-context__footer"><span>Acceso protegido</span><small>Sesiones privadas · permisos por rol · MFA administrativo</small></div>
    </section>

    <section className="auth-panel" aria-labelledby="employee-login-title">
      <div className="auth-panel__top"><p className="auth-kicker">Área interna</p><Link href="/" className="auth-panel__back">Volver al sitio</Link></div>
      <div className="auth-panel__body">
        <h2 id="employee-login-title">Acceso interno</h2>
        <p className="auth-panel__intro">Ingresa con tu cuenta de empleado para continuar.</p>
        <form className="auth-form" onSubmit={submit} noValidate>
          <label><span>Correo</span><input type="email" name="email" autoComplete="username" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label><span>Contraseña</span><input type="password" name="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label><span>Código de autenticación <small>si tu cuenta lo solicita</small></span><input type="text" name="mfaCode" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} /></label>
          {error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Verificando…' : 'Entrar'}</button>
        </form>
        <Link className="auth-panel__recovery" href="/login/recovery">¿Olvidaste tu contraseña?</Link>
      </div>
      <p className="auth-panel__note">Si necesitas acceso, solicita a un administrador que revise tu cuenta.</p>
    </section>
  </main>;
}

