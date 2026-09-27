'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { PrivateDialog, PrivateSelect, PrivateTextArea, PrivateTextField } from '@/components/private/ui';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import {
  QUOTE_REQUEST_BUDGET_RANGE_LABELS,
  QUOTE_REQUEST_BUDGET_RANGES,
  QUOTE_REQUEST_PROJECT_STAGE_LABELS,
  QUOTE_REQUEST_PROJECT_STAGES,
  QUOTE_REQUEST_TIMELINE_LABELS,
  QUOTE_REQUEST_TIMELINES,
} from '@/server/modules/quote-requests/domain';

export type StaffRequestEditTarget = {
  id: string;
  folio: string;
  status: string;
  contact: { displayName: string; email: string; phone: string | null; roleTitle: string | null };
  detail: { projectType: string; location: string; projectStage: string | null; dimensions: string | null; timeline: string | null; budgetRange: string | null; description: string } | null;
};

/** Campo que recibe el foco al abrir (p. ej. "medidas" desde "Faltan: medidas"). */
export type StaffRequestEditFocus = 'contact.email' | 'contact.phone' | 'detail.dimensions' | 'detail.timeline' | 'detail.budgetRange';

type EditForm = {
  displayName: string;
  email: string;
  phone: string;
  roleTitle: string;
  projectType: string;
  location: string;
  projectStage: string;
  timeline: string;
  budgetRange: string;
  dimensions: string;
  description: string;
  reason: string;
};

// Mismo criterio que el servidor (PUBLISHED_REQUEST_STATUSES): con propuesta publicada, cualquier
// corrección necesita motivo.
const PUBLISHED_STATUSES = ['COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA_EN_PROYECTO'];

const FOCUS_IDS: Record<StaffRequestEditFocus, string> = {
  'contact.email': 'request-edit-email',
  'contact.phone': 'request-edit-phone',
  'detail.dimensions': 'request-edit-dimensions',
  'detail.timeline': 'request-edit-timeline',
  'detail.budgetRange': 'request-edit-budget',
};

function toForm(target: StaffRequestEditTarget): EditForm {
  return {
    displayName: target.contact.displayName,
    email: target.contact.email,
    phone: target.contact.phone ?? '',
    roleTitle: target.contact.roleTitle ?? '',
    projectType: target.detail?.projectType ?? '',
    location: target.detail?.location ?? '',
    projectStage: target.detail?.projectStage ?? '',
    timeline: target.detail?.timeline ?? '',
    budgetRange: target.detail?.budgetRange ?? '',
    dimensions: target.detail?.dimensions ?? '',
    description: target.detail?.description ?? '',
    reason: '',
  };
}

/**
 * Corrección de datos del expediente en la vista clásica: contacto (p. ej. un correo mal escrito) y
 * proyecto (las medidas o el presupuesto que el cliente dio por teléfono). Antes sólo existía en la
 * bandeja V2, así que con la vista por omisión no había forma de corregir ni de completar lo que
 * "Faltan: …" pedía. Usa el mismo PATCH y las mismas reglas de motivo que el servidor.
 */
export default function StaffRequestEditDialog({ open, target, focus, onClose, onSaved }: {
  open: boolean;
  target: StaffRequestEditTarget;
  focus?: StaffRequestEditFocus | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<EditForm>(() => toForm(target));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura parte de los datos vigentes del expediente (nunca de un borrador de otro folio).
  useEffect(() => {
    if (!open) return;
    setForm(toForm(target));
    setError(null);
    if (!focus) return;
    const frame = window.requestAnimationFrame(() => {
      const field = document.getElementById(FOCUS_IDS[focus]);
      field?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir; `target` cambia tras guardar
  }, [open]);

  const sensitiveChange = form.email.trim().toLowerCase() !== target.contact.email.trim().toLowerCase() || form.phone.trim() !== (target.contact.phone ?? '').trim();
  const reasonRequired = sensitiveChange || PUBLISHED_STATUSES.includes(target.status);
  const update = <Key extends keyof EditForm>(key: Key, value: EditForm[Key]) => setForm((current) => ({ ...current, [key]: value }));
  const stageOptions = useMemo(() => QUOTE_REQUEST_PROJECT_STAGES.map((value) => ({ value, label: QUOTE_REQUEST_PROJECT_STAGE_LABELS[value] })), []);
  const timelineOptions = useMemo(() => QUOTE_REQUEST_TIMELINES.map((value) => ({ value, label: QUOTE_REQUEST_TIMELINE_LABELS[value] })), []);
  const budgetOptions = useMemo(() => QUOTE_REQUEST_BUDGET_RANGES.map((value) => ({ value, label: QUOTE_REQUEST_BUDGET_RANGE_LABELS[value] })), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reasonRequired && !form.reason.trim()) {
      setError(sensitiveChange ? 'Indica el motivo: cambiar el correo o el teléfono cambia a quién le llegan los avisos.' : 'Indica el motivo: este expediente ya tiene una propuesta publicada.');
      document.getElementById('request-edit-reason')?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${encodeURIComponent(target.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contact: { displayName: form.displayName, email: form.email, phone: form.phone.trim() || null, roleTitle: form.roleTitle.trim() || null },
          detail: { projectType: form.projectType, location: form.location, projectStage: form.projectStage || null, timeline: form.timeline || null, budgetRange: form.budgetRange || null, dimensions: form.dimensions.trim() || null, description: form.description },
          reason: form.reason.trim() || undefined,
        }),
      });
      await readApiResponseOrThrow(response, 'No fue posible guardar los cambios.');
      await onSaved(sensitiveChange ? 'Datos guardados. Los avisos pendientes al correo anterior se cancelaron; los nuevos irán al correo corregido.' : 'Datos del expediente guardados.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar los cambios.');
    } finally {
      setBusy(false);
    }
  };

  return <PrivateDialog open={open} onClose={() => { if (!busy) onClose(); }} className="quotes-preflight-dialog staff-request-edit" overlayClassName="quotes-preflight-overlay" labelledBy="request-edit-title" describedBy="request-edit-description">
    <div className="quotes-preflight-dialog__head"><h3 id="request-edit-title">Editar datos de {target.folio}</h3><button className="staff-dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
    <p id="request-edit-description" className="quotes-preflight-dialog__copy">Corrige el contacto o completa el proyecto con lo que te compartió el cliente. Cada cambio queda en la auditoría del expediente.</p>
    <form className="staff-request-edit__form" onSubmit={(event) => void submit(event)}>
      <fieldset className="staff-request-edit__group"><legend>Contacto</legend><div className="staff-request-edit__grid">
        <PrivateTextField id="request-edit-display-name" label="Nombre" value={form.displayName} onChange={(event) => update('displayName', event.target.value)} required autoComplete="off" maxLength={180} />
        <PrivateTextField id="request-edit-email" label="Correo" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} required autoComplete="off" maxLength={254} />
        <PrivateTextField id="request-edit-phone" label="Teléfono" type="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)} autoComplete="off" maxLength={40} optionalHint />
        <PrivateTextField id="request-edit-role" label="Cargo" value={form.roleTitle} onChange={(event) => update('roleTitle', event.target.value)} autoComplete="off" maxLength={120} optionalHint />
      </div></fieldset>
      <fieldset className="staff-request-edit__group"><legend>Proyecto</legend><div className="staff-request-edit__grid">
        <PrivateTextField id="request-edit-project" label="Tipo de proyecto" value={form.projectType} onChange={(event) => update('projectType', event.target.value)} required maxLength={120} />
        <PrivateTextField id="request-edit-location" label="Ubicación" value={form.location} onChange={(event) => update('location', event.target.value)} required maxLength={180} />
        <PrivateTextField id="request-edit-dimensions" label="Medidas" value={form.dimensions} onChange={(event) => update('dimensions', event.target.value)} maxLength={500} placeholder="Por ejemplo: 8 × 4 m, profundidad 1.5 m" optionalHint />
        <PrivateSelect id="request-edit-stage" label="Etapa" value={form.projectStage} options={stageOptions} onValueChange={(value) => update('projectStage', value)} placeholder="Sin dato" />
        <PrivateSelect id="request-edit-timeline" label="Fecha de inicio" value={form.timeline} options={timelineOptions} onValueChange={(value) => update('timeline', value)} placeholder="Sin dato" />
        <PrivateSelect id="request-edit-budget" label="Presupuesto" value={form.budgetRange} options={budgetOptions} onValueChange={(value) => update('budgetRange', value)} placeholder="Sin dato" />
      </div>
      <PrivateTextArea id="request-edit-description" label="Alcance" value={form.description} onChange={(event) => update('description', event.target.value)} required rows={4} maxLength={10000} /></fieldset>
      <fieldset className="staff-request-edit__group"><legend>Motivo</legend>
        <p className={`staff-request-edit__impact${sensitiveChange ? ' is-sensitive' : ''}`}>{sensitiveChange ? 'Cambia a quién le llegan los avisos del expediente: los pendientes al dato anterior se cancelan.' : reasonRequired ? 'El expediente ya tiene una propuesta publicada: cualquier corrección necesita motivo.' : 'Opcional para este cambio.'}</p>
        <PrivateTextArea id="request-edit-reason" label="Motivo del cambio" value={form.reason} onChange={(event) => update('reason', event.target.value)} required={reasonRequired} rows={2} maxLength={500} placeholder={sensitiveChange ? 'Por ejemplo: el cliente confirmó por teléfono su correo correcto' : 'Por ejemplo: el cliente nos dio las medidas por teléfono'} />
      </fieldset>
      {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
      <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="staff-button staff-button--dark" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>
  </PrivateDialog>;
}
