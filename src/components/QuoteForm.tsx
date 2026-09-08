'use client';

import { FormEvent, useRef, useState } from 'react';
import { DirectionalIcon } from '@/components/DirectionalIcon';
import { contactDetails } from '@/lib/pool-content';

type QuoteFormData = {
  nombre: string;
  telefono: string;
  email: string;
  tipoProyecto: string;
  ubicacion: string;
  mensaje: string;
};

const initialForm: QuoteFormData = {
  nombre: '',
  telefono: '',
  email: '',
  tipoProyecto: '',
  ubicacion: '',
  mensaje: '',
};

export default function QuoteForm() {
  const [formData, setFormData] = useState<QuoteFormData>(initialForm);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const isValid = Boolean(
    formData.nombre.trim() &&
    formData.telefono.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim()) &&
    formData.tipoProyecto &&
    formData.ubicacion.trim() &&
    formData.mensaje.trim() &&
    acceptTerms,
  );

  const updateField = (field: keyof QuoteFormData, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }));
    idempotencyKeyRef.current = null;
    if (feedback) setFeedback(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid) return;

    setIsSubmitting(true);
    setFeedback(null);
    idempotencyKeyRef.current ??= crypto.randomUUID();

    try {
      const response = await fetch('/api/quote-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          displayName: formData.nombre,
          phone: formData.telefono,
          email: formData.email,
          projectType: formData.tipoProyecto,
          location: formData.ubicacion,
          description: formData.mensaje,
          consent: acceptTerms,
        }),
      });
      const data = await response.json() as { accepted?: boolean; folio?: string; error?: { message?: string } };

      if (!response.ok || !data.accepted || !data.folio) {
        throw new Error(data.error?.message || 'No fue posible registrar tu solicitud.');
      }

      setFeedback({ type: 'success', message: `Recibimos tu solicitud. Tu folio es ${data.folio}. Consérvalo para futuras conversaciones.` });
      setFormData(initialForm);
      setAcceptTerms(false);
      idempotencyKeyRef.current = null;
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'No fue posible enviar tu solicitud. Inténtalo de nuevo.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="quote-layout">
      <div className="quote-form-wrap">
        <div className="form-heading">
          <p className="section-kicker section-kicker--dark">Información inicial</p>
          <h3>Datos para revisar tu proyecto.</h3>
          <p>Completa los datos básicos y te contactaremos para revisar el alcance de tu proyecto.</p>
        </div>

        <form className="quote-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              <span>Nombre</span>
              <input id="quote-name" name="nombre" value={formData.nombre} onChange={(event) => updateField('nombre', event.target.value)} placeholder="Tu nombre" autoComplete="name" minLength={2} maxLength={180} required />
            </label>
            <label>
              <span>Teléfono</span>
              <input id="quote-phone" name="telefono" value={formData.telefono} onChange={(event) => updateField('telefono', event.target.value)} placeholder="667 000 0000" autoComplete="tel" minLength={7} maxLength={40} required />
            </label>
            <label>
              <span>Correo</span>
              <input id="quote-email" type="email" name="email" value={formData.email} onChange={(event) => updateField('email', event.target.value)} placeholder="tu@correo.com" autoComplete="email" maxLength={320} required />
            </label>
            <label>
              <span>Tipo de obra</span>
              <select id="quote-project-type" name="tipoProyecto" value={formData.tipoProyecto} onChange={(event) => updateField('tipoProyecto', event.target.value)} required>
                <option value="">Selecciona una opción</option>
                <option value="Alberca residencial">Alberca residencial</option>
                <option value="Club de playa u hospitalidad">Club de playa u hospitalidad</option>
                <option value="Remodelación o rehabilitación">Remodelación o rehabilitación</option>
                <option value="Otro espacio acuático">Otro espacio acuático</option>
              </select>
            </label>
            <label className="form-field--wide">
              <span>Ubicación</span>
              <input id="quote-location" name="ubicacion" value={formData.ubicacion} onChange={(event) => updateField('ubicacion', event.target.value)} placeholder="Ciudad, estado o destino" autoComplete="address-level2" minLength={2} maxLength={180} required />
            </label>
            <label className="form-field--wide">
              <span>Descripción del proyecto</span>
              <textarea id="quote-description" name="mensaje" value={formData.mensaje} onChange={(event) => updateField('mensaje', event.target.value)} placeholder="Ej. terreno nuevo, remodelación o equipamiento." rows={5} minLength={10} maxLength={10_000} required />
            </label>
          </div>

          <label className="consent-row">
            <input id="quote-consent" name="consent" type="checkbox" checked={acceptTerms} onChange={(event) => { setAcceptTerms(event.target.checked); idempotencyKeyRef.current = null; setFeedback(null); }} />
            <span>Autorizo a OCPOOL a usar estos datos para contactarme sobre esta solicitud.</span>
          </label>

          {feedback && <p className={`form-feedback form-feedback--${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'} aria-live="polite">{feedback.message}</p>}

          <div className="form-actions">
            <button className="button button--dark" type="submit" disabled={!isValid || isSubmitting}>
              {isSubmitting ? 'Enviando…' : 'Enviar solicitud'} <DirectionalIcon />
            </button>
            <span className="form-note">Atención inicial por correo o WhatsApp.</span>
          </div>
        </form>
      </div>

      <aside className="quote-aside">
        <div>
          <p className="section-kicker section-kicker--dark">Contacto directo</p>
          <h3>También puedes escribirnos directamente.</h3>
          <p>Si ya tienes planos, medidas o fotografías, puedes enviarlos por estos canales.</p>
          <ul className="quote-aside__list">
            <li>Ubicación y tipo de obra</li>
            <li>Medidas, planos o fotografías</li>
            <li>Alcance deseado: nueva, remodelación o equipamiento</li>
          </ul>
          <div className="direct-links">
            <a href={`mailto:${contactDetails.email}`}>{contactDetails.email} <DirectionalIcon /></a>
            <a href={contactDetails.phoneHref}>{contactDetails.phone} <DirectionalIcon /></a>
            <a href={contactDetails.whatsappHref} target="_blank" rel="noreferrer">WhatsApp <DirectionalIcon /></a>
          </div>
        </div>
      </aside>
    </div>
  );
}
