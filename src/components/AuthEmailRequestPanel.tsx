'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { useHydrated } from '@/lib/use-hydrated';
import Link from 'next/link';
import WorkspaceBrand from '@/components/WorkspaceBrand';

type RequestKind = 'customer' | 'recovery';

// Espera antes de permitir reenviar: evita ráfagas (el servidor además limita por tasa) y da tiempo
// a que llegue el primer correo antes de pedir otro.
const RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

async function publicError(response: Response): Promise<string> {
  if (response.status === 429) return 'El acceso está temporalmente limitado. Espera unos minutos y vuelve a intentarlo.';
  return 'No fue posible procesar la solicitud. Intenta de nuevo.';
}

export default function AuthEmailRequestPanel({ kind }: { kind: RequestKind }) {
  const customer = kind === 'customer';
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redirectRequestId, setRedirectRequestId] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!customer) return;
    setRedirectRequestId(new URLSearchParams(window.location.search).get('request'));
  }, [customer]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const requestLink = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(customer ? '/api/auth/customer/request-link' : '/api/auth/recovery/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address, ...(customer && redirectRequestId ? { redirectRequestId } : {}) }),
      });
      if (!response.ok) throw new Error(await publicError(response));
      setSentTo(address);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible procesar la solicitud. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setError('Escribe un correo válido, por ejemplo nombre@empresa.com.');
      emailInputRef.current?.focus();
      return;
    }
    await requestLink(address);
  };

  const switchEmail = () => {
    setSentTo(null);
    setError(null);
    setCooldown(0);
    window.requestAnimationFrame(() => emailInputRef.current?.focus());
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
        {sentTo ? <div className="auth-sent">
          <span className="auth-sent__mark" aria-hidden="true"><MailCheck size={22} /></span>
          <h2 id="auth-request-title">Revisa tu correo</h2>
          {/* Una sola región de estado con todo el resultado: la respuesta es idéntica exista o no la
              cuenta (no se revela quién tiene acceso), así que se explican ambos casos. */}
          <div className="auth-feedback auth-feedback--success" role="status">
            {customer
              ? <><p>Si tu cuenta ya está habilitada, recibirás un enlace seguro en unos minutos.</p><p>Si eres cliente nuevo, primero revisaremos tu solicitud y el equipo habilitará tu portal; el enlace llegará después de ese paso.</p></>
              : <p>Si el correo está asociado a una cuenta activa, recibirás un enlace en unos minutos.</p>}
          </div>
          <p className="auth-sent__email">Solicitado para <strong>{sentTo}</strong></p>
          <ul className="auth-sent__tips"><li>El enlace es de un solo uso y vence pronto.</li><li>Si no llega, revisa la carpeta de spam o promociones.</li></ul>
          {error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}
          <div className="auth-sent__actions">
            <button className="auth-submit auth-submit--secondary" type="button" disabled={busy || cooldown > 0} onClick={() => void requestLink(sentTo)}>{busy ? 'Enviando…' : cooldown > 0 ? `Reenviar en ${cooldown} s` : 'Reenviar enlace'}</button>
            <button className="auth-text-button" type="button" onClick={switchEmail} disabled={busy}>Usar otro correo</button>
          </div>
        </div> : <>
          <h2 id="auth-request-title">{customer ? 'Accede a tu portal' : 'Recupera tu acceso'}</h2>
          <p className="auth-panel__intro">{customer ? 'Escribe el correo con el que te registraste y te enviaremos un enlace seguro de un solo uso. Si acabas de pedir una cotización, conserva tu folio: habilitaremos tu portal al revisar tu solicitud.' : 'Te enviaremos un enlace temporal para definir una nueva contraseña.'}</p>
          <form className="auth-form" method="post" onSubmit={submit} noValidate>
            <label><span>Correo</span><input ref={emailInputRef} type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(null); }} aria-invalid={error ? true : undefined} /></label>
            {error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={busy || !hydrated}>{busy ? 'Enviando…' : customer ? 'Solicitar acceso' : 'Enviar solicitud'}</button>
          </form>
        </>}
      </div>
      <p className="auth-panel__note">Por seguridad, la respuesta es la misma aunque el correo no esté asociado a una cuenta.</p>
    </section>
  </main>;
}
