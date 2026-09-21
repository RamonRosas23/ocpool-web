'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import WorkspaceBrand from '@/components/WorkspaceBrand';

type SessionResponse = { type?: 'EMPLOYEE' | 'CUSTOMER' };
type ErrorResponse = { error?: { code?: string; message?: string } };

async function readErrorBody(response: Response): Promise<ErrorResponse> {
  return await response.json().catch(() => ({})) as ErrorResponse;
}

// UX audit fix: el ternario original devolvía el mismo texto fijo en ambas ramas, así que nunca
// usaba `body.error.message` -- pero incluso corrigiendo sólo eso no habría bastado: el servidor
// no distingue "contraseña incorrecta" de "código MFA incorrecto" en su mensaje (ambos caen al
// mismo `AppError('UNAUTHORIZED', 'Correo o contraseña inválidos.')`, por diseño, para no revelar
// en qué paso falló el intento). Si el intento falla mientras ya se pidió el código MFA, correo y
// contraseña siguen deshabilitados en el formulario (ver `disabled={mfaRequired}` abajo) -- decirle
// al usuario "verifica tus datos" ahí apunta a campos que no puede tocar. `mfaRequired` (ya
// disponible en el cliente) decide el mensaje correcto sin depender de que el servidor lo revele.
function errorMessage(response: Response, body: ErrorResponse, mfaRequired: boolean): string {
  if (response.status === 429) return 'El acceso está temporalmente limitado. Espera unos minutos y vuelve a intentarlo.';
  if (mfaRequired) return 'Código incorrecto o expirado. Verifica el código de tu app de autenticación.';
  return body.error?.message ?? 'No fue posible iniciar sesión. Verifica tus datos.';
}

export default function EmployeeLoginPanel() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
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
      if (!response.ok) {
        const body = await readErrorBody(response);
        if (body.error?.code === 'MFA_REQUIRED') {
          setMfaRequired(true);
          setError(null);
          return;
        }
        throw new Error(errorMessage(response, body, mfaRequired));
      }
      window.location.assign('/staff');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible iniciar sesión. Verifica tus datos.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-shell auth-shell--staff">
    <section className="auth-context" aria-label="Contexto de acceso">
      <WorkspaceBrand className="auth-brand" subtitle="Operaciones comerciales" />
      <div className="auth-context__copy"><p className="auth-kicker">Espacios que toman forma</p><h1>La operación también merece <em>intención.</em></h1><p>Un espacio de trabajo para dar seguimiento a cada solicitud, cada conversación y cada propuesta con claridad.</p></div>
      <div className="auth-context__footer"><span>Acceso protegido</span><small>Sesiones privadas · permisos por rol · MFA administrativo</small></div>
    </section>

    <section className="auth-panel" aria-labelledby="employee-login-title">
      <div className="auth-panel__top"><p className="auth-kicker">Área interna</p><Link href="/" className="auth-panel__back">Volver al sitio</Link></div>
      <div className="auth-panel__body">
        <h2 id="employee-login-title">Acceso interno</h2>
        <p className="auth-panel__intro">{mfaRequired ? 'Ingresa el código de tu app de autenticación para continuar.' : 'Ingresa con tu cuenta de empleado para continuar.'}</p>
        <form className="auth-form" onSubmit={submit} noValidate>
          <label><span>Correo</span><input type="email" name="email" autoComplete="username" inputMode="email" required disabled={mfaRequired} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label><span>Contraseña</span><input type="password" name="password" autoComplete="current-password" required disabled={mfaRequired} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {mfaRequired && <label><span>Código de autenticación</span><input type="text" name="mfaCode" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus required value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} /></label>}
          {error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Verificando…' : mfaRequired ? 'Verificar código' : 'Entrar'}</button>
        </form>
        <Link className="auth-panel__recovery" href="/login/recovery">¿Olvidaste tu contraseña?</Link>
      </div>
      <p className="auth-panel__note">Si necesitas acceso, solicita a un administrador que revise tu cuenta.</p>
    </section>
  </main>;
}
