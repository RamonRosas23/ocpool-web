'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import WorkspaceBrand from '@/components/WorkspaceBrand';

type RequestKind = 'customer' | 'recovery';
type ErrorResponse = { error?: { message?: string } };

async function publicError(response: Response): Promise<string> {
  if (response.status === 429) return 'El acceso está temporalmente limitado. Espera unos minutos y vuelve a intentarlo.';
  const body = await response.json().catch(() => ({})) as ErrorResponse;
  return body.error?.message ? 'No fue posible procesar la solicitud. Intenta de nuevo.' : 'No fue posible procesar la solicitud. Intenta de nuevo.';
}

export default function AuthEmailRequestPanel({ kind }: { kind: RequestKind }) {
  const customer = kind === 'customer';
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(customer ? '/api/auth/customer/request-link' : '/api/auth/recovery/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error(await publicError(response));
      setNotice(customer
        ? 'Solicitud recibida. Si tu cuenta ya está habilitada, recibirás un enlace seguro en unos minutos. Si eres cliente nuevo, tu cuenta todavía no existe: primero revisaremos tu solicitud y el equipo habilitará tu portal. No recibirás un enlace antes de ese paso.'
        : 'Si el correo está asociado a una cuenta activa, recibirás un enlace en unos minutos.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible procesar la solicitud. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return <main className={`auth-shell auth-shell--${customer ? 'client' : 'recovery'}`}>
    <section className="auth-context" aria-label="Contexto de acceso">
      <WorkspaceBrand className="auth-brand" subtitle={customer ? 'Portal de cliente' : 'Acceso interno'} />
      <div className="auth-context__copy"><p className="auth-kicker">{customer ? 'Tu proyecto, contigo' : 'Acceso protegido'}</p><h1>{customer ? <>Tu proyecto, a un enlace de <em>distancia.</em></> : <>Volver a entrar con <em>claridad.</em></>}</h1><p>{customer ? 'Consulta avances, propuestas y conversaciones desde un espacio privado pensado para acompañarte.' : 'Restablece tu acceso interno con un enlace de un solo uso y vuelve a la operación.'}</p></div>
      <div className="auth-context__footer"><span>{customer ? 'Portal privado' : 'Recuperación segura'}</span><small>Un enlace temporal · una acción clara</small></div>
    </section>

    <section className="auth-panel" aria-labelledby="auth-request-title">
      <div className="auth-panel__top"><p className="auth-kicker">{customer ? 'Entrada de cliente' : 'Recuperación'}</p><Link href={customer ? '/' : '/login'} className="auth-panel__back">{customer ? 'Volver al sitio' : 'Volver al acceso'}</Link></div>
      <div className="auth-panel__body">
        <h2 id="auth-request-title">{customer ? 'Accede a tu portal' : 'Recupera tu acceso'}</h2>
        <p className="auth-panel__intro">{customer ? 'Este formulario sólo envía un enlace cuando existe una cuenta cliente activa. Si acabas de pedir una cotización y nunca has tenido acceso, conserva tu folio: primero revisaremos tu solicitud, habilitaremos tu portal y después recibirás un enlace seguro de un solo uso.' : 'Te enviaremos un enlace temporal para definir una nueva contraseña.'}</p>
        <form className="auth-form" onSubmit={submit} noValidate>
          <label><span>Correo</span><input type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          {error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}
          {notice && <p className="auth-feedback auth-feedback--success" role="status">{notice}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Enviando…' : customer ? 'Solicitar acceso' : 'Enviar solicitud'}</button>
        </form>
      </div>
      <p className="auth-panel__note">Por seguridad, la respuesta es la misma aunque el correo no esté asociado a una cuenta.</p>
    </section>
  </main>;
}
