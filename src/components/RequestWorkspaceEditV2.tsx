'use client';

import { forwardRef, FormEvent, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PrivateBlockingState, PrivateButton, PrivateSelect, PrivateTextArea, PrivateTextField } from '@/components/private/ui';
import { getApiErrorMessage } from '@/lib/api-error-message';
import {
  QUOTE_REQUEST_BUDGET_RANGE_LABELS,
  QUOTE_REQUEST_BUDGET_RANGES,
  QUOTE_REQUEST_PROJECT_STAGE_LABELS,
  QUOTE_REQUEST_PROJECT_STAGES,
  QUOTE_REQUEST_TIMELINE_LABELS,
  QUOTE_REQUEST_TIMELINES,
  type QuoteRequestStatus,
} from '@/server/modules/quote-requests/domain';

export type RequestWorkspaceEditData = {
  id: string;
  updatedAt: string;
  status: QuoteRequestStatus;
  contact: { displayName: string; email: string; phone: string | null; roleTitle: string | null };
  detail: { projectType: string; location: string; dimensions: string | null; projectStage: string | null; timeline: string | null; budgetRange: string | null; description: string } | null;
};

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

type ErrorResponse = { error?: { message?: string; requestId?: string } };
const PUBLISHED_STATUSES: readonly QuoteRequestStatus[] = ['COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA_EN_PROYECTO'];

function toForm(data: RequestWorkspaceEditData): EditForm {
  return {
    displayName: data.contact.displayName,
    email: data.contact.email,
    phone: data.contact.phone ?? '',
    roleTitle: data.contact.roleTitle ?? '',
    projectType: data.detail?.projectType ?? '',
    location: data.detail?.location ?? '',
    projectStage: data.detail?.projectStage ?? '',
    timeline: data.detail?.timeline ?? '',
    budgetRange: data.detail?.budgetRange ?? '',
    dimensions: data.detail?.dimensions ?? '',
    description: data.detail?.description ?? '',
    reason: '',
  };
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(getApiErrorMessage(data, 'No fue posible guardar los cambios.'));
  return data as T;
}

export type RequestWorkspaceEditHandle = { open: () => void };

const RequestWorkspaceEditV2 = forwardRef<RequestWorkspaceEditHandle, { data: RequestWorkspaceEditData; canEdit: boolean; onUpdated: () => Promise<void> }>(function RequestWorkspaceEditV2({ data, canEdit, onUpdated }, ref) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EditForm>(() => toForm(data));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // UX audit fix: el menú "Más acciones" del encabezado tenía su propia entrada "Editar expediente"
  // que sólo hacía scroll hasta esta sección (`href="#request-workspace-v2-edit"`, ver
  // RequestWorkspaceDetailV2.tsx) sin abrir el formulario -- el staff llegaba al resumen "Datos
  // corregibles" colapsado y tenía que encontrar y hacer clic en ESTE OTRO botón, con la misma
  // etiqueta, para realmente empezar a editar. Exponer `open()` deja que el encabezado abra el
  // panel de verdad, con el mismo patrón `forwardRef`/`useImperativeHandle` que ya usa
  // RequestWorkspaceActionsV2 en el mismo archivo padre.
  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);

  // UX audit fix: navegar a un expediente distinto NO remonta este componente (Next.js reutiliza
  // la misma instancia entre navegaciones de un segmento dinámico) -- si el panel de edición se
  // quedaba abierto, `form` seguía mostrando los campos del expediente ANTERIOR mientras `data.id`
  // (usado en la URL del PATCH) ya apuntaba al expediente nuevo, arriesgando que los datos de un
  // contacto/proyecto se guardaran sobre el folio equivocado. `lastDataIdRef` distingue un cambio
  // real de expediente (fuerza cierre + resincronización, sin importar `open`) de una simple
  // actualización de contenido del mismo expediente (p.ej. tras guardar), que conserva el
  // comportamiento original de sólo resincronizar cuando el panel está cerrado.
  const lastDataIdRef = useRef(data.id);
  useEffect(() => {
    if (data.id !== lastDataIdRef.current) {
      lastDataIdRef.current = data.id;
      setOpen(false);
      setForm(toForm(data));
      return;
    }
    if (!open) setForm(toForm(data));
  }, [data, open]);

  const sensitiveChange = form.email.trim().toLowerCase() !== data.contact.email.trim().toLowerCase() || form.phone.trim() !== (data.contact.phone ?? '').trim();
  const reasonRequired = sensitiveChange || PUBLISHED_STATUSES.includes(data.status);
  const update = <Key extends keyof EditForm>(key: Key, value: EditForm[Key]) => setForm((current) => ({ ...current, [key]: value }));
  const stageOptions = useMemo(() => QUOTE_REQUEST_PROJECT_STAGES.map((value) => ({ value, label: QUOTE_REQUEST_PROJECT_STAGE_LABELS[value] })), []);
  const timelineOptions = useMemo(() => QUOTE_REQUEST_TIMELINES.map((value) => ({ value, label: QUOTE_REQUEST_TIMELINE_LABELS[value] })), []);
  const budgetOptions = useMemo(() => QUOTE_REQUEST_BUDGET_RANGES.map((value) => ({ value, label: QUOTE_REQUEST_BUDGET_RANGE_LABELS[value] })), []);

  if (!canEdit) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reasonRequired && !form.reason.trim()) {
      setError('Indica el motivo porque cambia el destinatario o el expediente ya está publicado.');
      setNotice(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${encodeURIComponent(data.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contact: { displayName: form.displayName, email: form.email, phone: form.phone.trim() || null, roleTitle: form.roleTitle.trim() || null },
          detail: { projectType: form.projectType, location: form.location, projectStage: form.projectStage || null, timeline: form.timeline || null, budgetRange: form.budgetRange || null, dimensions: form.dimensions.trim() || null, description: form.description },
          reason: form.reason.trim() || undefined,
        }),
      });
      await readResponse(response);
      await onUpdated();
      setOpen(false);
      setNotice('Cambios guardados.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar los cambios.');
    } finally {
      setBusy(false);
    }
  };

  return <section id="request-workspace-v2-edit" className="request-workspace-v2__edit" aria-labelledby="request-workspace-v2-edit-title">
    <div className="request-workspace-v2__edit-head"><div><p className="private-kicker">Perfil comercial</p><h2 id="request-workspace-v2-edit-title">Datos corregibles</h2></div><PrivateButton type="button" variant="quiet" onClick={() => { setOpen((current) => !current); setError(null); setNotice(null); }}>{open ? 'Cancelar edición' : 'Editar expediente'}</PrivateButton></div>
    {notice && <p className="private-status private-status--success" role="status">{notice}</p>}
    {error && <PrivateBlockingState title="No fue posible guardar los cambios.">{error}</PrivateBlockingState>}
    {open && <form className="request-workspace-v2__edit-form" onSubmit={(event) => void submit(event)}>
      <div className="request-workspace-v2__edit-group"><p className="private-kicker">Contacto</p><div className="request-workspace-v2__create-grid"><PrivateTextField id="request-edit-display-name" label="Nombre del contacto" value={form.displayName} onChange={(event) => update('displayName', event.target.value)} required autoComplete="name" /><PrivateTextField id="request-edit-email" label="Correo del contacto" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} required autoComplete="email" /><PrivateTextField id="request-edit-phone" label="Teléfono del contacto" value={form.phone} onChange={(event) => update('phone', event.target.value)} autoComplete="tel" /><PrivateTextField id="request-edit-role" label="Cargo del contacto" value={form.roleTitle} onChange={(event) => update('roleTitle', event.target.value)} /></div></div>
      <div className="request-workspace-v2__edit-group"><p className="private-kicker">Proyecto</p><div className="request-workspace-v2__create-grid"><PrivateTextField id="request-edit-project" label="Tipo de proyecto" value={form.projectType} onChange={(event) => update('projectType', event.target.value)} required /><PrivateTextField id="request-edit-location" label="Ubicación del proyecto" value={form.location} onChange={(event) => update('location', event.target.value)} required /><PrivateSelect id="request-edit-stage" label="Etapa del proyecto" value={form.projectStage} options={stageOptions} onValueChange={(value) => update('projectStage', value)} placeholder="Por definir" /><PrivateSelect id="request-edit-timeline" label="Horizonte del proyecto" value={form.timeline} options={timelineOptions} onValueChange={(value) => update('timeline', value)} placeholder="Por definir" /><PrivateSelect id="request-edit-budget" label="Presupuesto del proyecto" value={form.budgetRange} options={budgetOptions} onValueChange={(value) => update('budgetRange', value)} placeholder="Por definir" /><PrivateTextField id="request-edit-dimensions" label="Dimensiones del proyecto" value={form.dimensions} onChange={(event) => update('dimensions', event.target.value)} /></div><PrivateTextArea id="request-edit-description" label="Descripción del proyecto" value={form.description} onChange={(event) => update('description', event.target.value)} required rows={5} /></div>
      <div className="request-workspace-v2__edit-group"><p className="private-kicker">Control</p><p className="request-workspace-v2__edit-impact">{sensitiveChange ? 'Cambiar correo o teléfono modifica el destinatario operativo del expediente.' : PUBLISHED_STATUSES.includes(data.status) ? 'Este expediente ya está publicado y cualquier corrección necesita motivo.' : 'Los cambios se guardan con trazabilidad.'}</p><PrivateTextArea id="request-edit-reason" label="Motivo del cambio" value={form.reason} onChange={(event) => update('reason', event.target.value)} required={reasonRequired} description={reasonRequired ? 'Obligatorio para este cambio.' : 'Opcional.'} rows={3} /></div>
      <div className="request-workspace-v2__edit-actions"><PrivateButton type="submit" busy={busy}>Guardar cambios</PrivateButton></div>
    </form>}
  </section>;
});

export default RequestWorkspaceEditV2;
