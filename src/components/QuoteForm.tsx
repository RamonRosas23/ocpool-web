'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DirectionalIcon } from '@/components/DirectionalIcon';
import { contactDetails } from '@/lib/pool-content';

type QuoteFormData = {
  nombre: string;
  telefono: string;
  email: string;
  tipoProyecto: string;
  ubicacion: string;
  projectStage: string;
  dimensions: string;
  timeline: string;
  budgetRange: string;
  mensaje: string;
};

type FormErrors = Partial<Record<keyof QuoteFormData | 'consent', string>>;
type FormFeedback =
  | { type: 'success'; folio: string }
  | { type: 'error'; message: string };

const initialForm: QuoteFormData = {
  nombre: '',
  telefono: '',
  email: '',
  tipoProyecto: '',
  ubicacion: '',
  projectStage: '',
  dimensions: '',
  timeline: '',
  budgetRange: '',
  mensaje: '',
};

function firstError(errors: FormErrors, fields: Array<keyof FormErrors>): keyof FormErrors | null {
  return fields.find((field) => errors[field]) ?? null;
}

export default function QuoteForm() {
  const [formData, setFormData] = useState<QuoteFormData>(initialForm);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (step === 1) nameRef.current?.focus();
    if (step === 2) descriptionRef.current?.focus();
  }, [step]);

  const updateField = (field: keyof QuoteFormData, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    idempotencyKeyRef.current = null;
    if (feedback) setFeedback(null);
  };

  const validateStepOne = (): FormErrors => {
    const next: FormErrors = {};
    if (formData.nombre.trim().length < 2) next.nombre = 'Indica tu nombre para continuar.';
    if (formData.telefono.trim().length < 7) next.telefono = 'Indica un teléfono válido para continuar.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) next.email = 'Indica un correo válido para continuar.';
    if (!formData.tipoProyecto) next.tipoProyecto = 'Selecciona el tipo de obra.';
    if (formData.ubicacion.trim().length < 2) next.ubicacion = 'Indica la ubicación del proyecto.';
    return next;
  };

  const validateStepTwo = (): FormErrors => {
    const next: FormErrors = {};
    // El servidor acepta `dimensions` vacío (campo opcional) pero exige al menos 2 caracteres si se
    // llena (publicQuoteRequestSchema en api/quote-requests/route.ts) -- sin este chequeo, un valor
    // de 1 carácter pasaba sin aviso aquí y sólo fallaba al enviar, con el error genérico de arriba
    // del formulario sin apuntar a este campo en particular.
    if (formData.dimensions.trim() && formData.dimensions.trim().length < 2) next.dimensions = 'Escribe al menos 2 caracteres o deja el campo vacío.';
    if (formData.mensaje.trim().length < 10) next.mensaje = 'Cuéntanos un poco más sobre el alcance del proyecto.';
    if (!acceptTerms) next.consent = 'Necesitamos tu autorización para contactarte.';
    return next;
  };

  const focusError = (field: keyof FormErrors | null) => {
    if (field === 'nombre') nameRef.current?.focus();
    if (field === 'mensaje') descriptionRef.current?.focus();
    const fieldIds: Partial<Record<keyof FormErrors, string>> = {
      telefono: 'quote-phone',
      email: 'quote-email',
      tipoProyecto: 'quote-project-type',
      ubicacion: 'quote-location',
      consent: 'quote-consent',
    };
    if (field && !['nombre', 'mensaje'].includes(field)) {
      document.getElementById(fieldIds[field] ?? `quote-${field}`)?.focus();
    }
  };

  const handleContinue = () => {
    const nextErrors = validateStepOne();
    setErrors(nextErrors);
    const field = firstError(nextErrors, ['nombre', 'telefono', 'email', 'tipoProyecto', 'ubicacion']);
    if (field) {
      focusError(field);
      return;
    }
    setStep(2);
  };

  const handleBack = () => {
    setErrors({});
    setStep(1);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = { ...validateStepOne(), ...validateStepTwo() };
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      focusError(firstError(nextErrors, ['mensaje', 'consent', 'nombre', 'telefono', 'email', 'tipoProyecto', 'ubicacion']));
      return;
    }

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
          projectStage: formData.projectStage || undefined,
          dimensions: formData.dimensions || undefined,
          timeline: formData.timeline || undefined,
          budgetRange: formData.budgetRange || undefined,
          description: formData.mensaje,
          consent: acceptTerms,
          website: '',
        }),
      });
      const data = await response.json() as { accepted?: boolean; folio?: string; error?: { message?: string } };

      if (!response.ok || !data.accepted || !data.folio) {
        throw new Error(data.error?.message || 'No fue posible registrar tu solicitud.');
      }

      setFeedback({ type: 'success', folio: data.folio });
      setFormData(initialForm);
      setAcceptTerms(false);
      setErrors({});
      setStep(1);
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

  const errorMessage = (field: keyof FormErrors) => errors[field] ? <span id={`quote-${field}-error`} className="form-field-error" role="alert">{errors[field]}</span> : null;

  return (
    <div className="quote-layout">
      <div className="quote-form-wrap">
        <div className="form-heading">
          <p className="section-kicker section-kicker--dark">Información inicial</p>
          <h3>Datos para revisar tu proyecto.</h3>
          <p>Cuéntanos lo esencial. En el siguiente paso afinaremos el alcance para que la primera conversación sea más útil.</p>
        </div>

        <form className="quote-form" onSubmit={handleSubmit} noValidate>
          <div className="quote-stepper" aria-label="Progreso del formulario">
            <span className={step === 1 ? 'is-current' : 'is-complete'}><b>01</b> Tu contacto</span>
            <i aria-hidden="true" />
            <span className={step === 2 ? 'is-current' : ''}><b>02</b> Tu proyecto</span>
            <strong aria-live="polite">Paso {step} de 2</strong>
          </div>

          {step === 1 && <div className="form-grid">
            <label>
              <span>Nombre</span>
              <input ref={nameRef} id="quote-name" name="nombre" value={formData.nombre} onChange={(event) => updateField('nombre', event.target.value)} placeholder="Tu nombre" autoComplete="name" minLength={2} maxLength={180} aria-invalid={Boolean(errors.nombre)} aria-describedby={errors.nombre ? 'quote-nombre-error' : undefined} />
              {errorMessage('nombre')}
            </label>
            <label>
              <span>Teléfono</span>
              <input id="quote-phone" name="telefono" value={formData.telefono} onChange={(event) => updateField('telefono', event.target.value)} placeholder="667 000 0000" autoComplete="tel" minLength={7} maxLength={40} aria-invalid={Boolean(errors.telefono)} aria-describedby={errors.telefono ? 'quote-telefono-error' : undefined} />
              {errorMessage('telefono')}
            </label>
            <label>
              <span>Correo</span>
              <input id="quote-email" type="email" name="email" value={formData.email} onChange={(event) => updateField('email', event.target.value)} placeholder="tu@correo.com" autoComplete="email" maxLength={320} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'quote-email-error' : undefined} />
              {errorMessage('email')}
            </label>
            <label>
              <span>Tipo de obra</span>
              <select id="quote-project-type" name="tipoProyecto" value={formData.tipoProyecto} onChange={(event) => updateField('tipoProyecto', event.target.value)} aria-invalid={Boolean(errors.tipoProyecto)} aria-describedby={errors.tipoProyecto ? 'quote-tipoProyecto-error' : undefined}>
                <option value="">Selecciona una opción</option>
                <option value="Alberca residencial">Alberca residencial</option>
                <option value="Club de playa u hospitalidad">Club de playa u hospitalidad</option>
                <option value="Remodelación o rehabilitación">Remodelación o rehabilitación</option>
                <option value="Otro espacio acuático">Otro espacio acuático</option>
              </select>
              {errorMessage('tipoProyecto')}
            </label>
            <label className="form-field--wide">
              <span>Ubicación</span>
              <input id="quote-location" name="ubicacion" value={formData.ubicacion} onChange={(event) => updateField('ubicacion', event.target.value)} placeholder="Ciudad, estado o destino" autoComplete="address-level2" minLength={2} maxLength={180} aria-invalid={Boolean(errors.ubicacion)} aria-describedby={errors.ubicacion ? 'quote-ubicacion-error' : undefined} />
              {errorMessage('ubicacion')}
            </label>
          </div>}

          {step === 2 && <div className="form-grid">
            <label>
              <span>Etapa del proyecto</span>
              <select id="quote-project-stage" name="projectStage" value={formData.projectStage} onChange={(event) => updateField('projectStage', event.target.value)}>
                <option value="">Selecciona una opción</option>
                <option value="IDEA">Idea o planeación</option>
                <option value="SITE_READY">Terreno listo</option>
                <option value="UNDER_CONSTRUCTION">En construcción</option>
                <option value="REMODEL">Remodelación</option>
                <option value="EQUIPMENT_ONLY">Sólo equipamiento</option>
                <option value="UNSURE">Por definir</option>
              </select>
            </label>
            <label>
              <span>Medidas aproximadas</span>
              <input id="quote-dimensions" name="dimensions" value={formData.dimensions} onChange={(event) => updateField('dimensions', event.target.value)} placeholder="Ej. 12 x 5 m" minLength={2} maxLength={180} aria-invalid={Boolean(errors.dimensions)} aria-describedby={errors.dimensions ? 'quote-dimensions-error' : undefined} />
              {errorMessage('dimensions')}
            </label>
            <label>
              <span>Horizonte de inicio</span>
              <select id="quote-timeline" name="timeline" value={formData.timeline} onChange={(event) => updateField('timeline', event.target.value)}>
                <option value="">Selecciona una opción</option>
                <option value="ASAP">Lo antes posible</option>
                <option value="ONE_TO_THREE_MONTHS">En 1 a 3 meses</option>
                <option value="THREE_TO_SIX_MONTHS">En 3 a 6 meses</option>
                <option value="SIX_PLUS_MONTHS">Después de 6 meses</option>
                <option value="UNSURE">Por definir</option>
              </select>
            </label>
            <label>
              <span>Rango de inversión</span>
              <select id="quote-budget-range" name="budgetRange" value={formData.budgetRange} onChange={(event) => updateField('budgetRange', event.target.value)}>
                <option value="">Selecciona una opción</option>
                <option value="UNDER_250K">Hasta $250,000 MXN</option>
                <option value="FROM_250K_TO_500K">$250,000 a $500,000 MXN</option>
                <option value="FROM_500K_TO_1M">$500,000 a $1,000,000 MXN</option>
                <option value="OVER_1M">Más de $1,000,000 MXN</option>
                <option value="UNSURE">Por definir</option>
              </select>
            </label>
            <label className="form-field--wide">
              <span>Descripción del proyecto</span>
              <textarea ref={descriptionRef} id="quote-description" name="mensaje" value={formData.mensaje} onChange={(event) => updateField('mensaje', event.target.value)} placeholder="Ej. terreno nuevo, remodelación o equipamiento." rows={5} minLength={10} maxLength={10_000} aria-invalid={Boolean(errors.mensaje)} aria-describedby={errors.mensaje ? 'quote-mensaje-error' : undefined} />
              {errorMessage('mensaje')}
            </label>
          </div>}

          <input className="quote-form__honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />

          {step === 2 && <label className="consent-row">
            <input id="quote-consent" name="consent" type="checkbox" checked={acceptTerms} onChange={(event) => { setAcceptTerms(event.target.checked); setErrors((current) => { const next = { ...current }; delete next.consent; return next; }); idempotencyKeyRef.current = null; setFeedback(null); }} aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? 'quote-consent-error' : undefined} />
            <span>Autorizo a OCPOOL a usar estos datos para contactarme sobre esta solicitud.</span>
            {errorMessage('consent')}
          </label>}

          {feedback?.type === 'success' && <div className="form-feedback form-feedback--success" role="status" aria-live="polite">
            <p className="form-feedback__eyebrow">Solicitud recibida</p>
            <p className="form-feedback__folio">Tu folio es <strong>{feedback.folio}</strong>.</p>
            <p className="form-feedback__copy">Guárdalo para futuras conversaciones. El folio identifica tu solicitud; no es una contraseña ni permite iniciar sesión.</p>
            <p className="form-feedback__copy">Si es tu primera solicitud, todavía no tienes una cuenta del portal. Revisaremos tu información, habilitaremos tu acceso y después recibirás un enlace seguro de un solo uso. Por ahora no necesitas hacer nada más.</p>
            <Link className="button button--dark form-feedback__action" href="/portal/access">Ya tengo una cuenta: solicitar enlace <DirectionalIcon /></Link>
          </div>}
          {feedback?.type === 'error' && <p className="form-feedback form-feedback--error" role="alert" aria-live="polite">{feedback.message}</p>}

          <div className="form-actions">
            {step === 2 && <button className="button button--ghost" type="button" onClick={handleBack} disabled={isSubmitting}>Regresar</button>}
            {step === 1 ? <button className="button button--dark" type="button" onClick={handleContinue}>Continuar <DirectionalIcon /></button> : <button className="button button--dark" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Enviando…' : 'Enviar solicitud'} <DirectionalIcon /></button>}
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
