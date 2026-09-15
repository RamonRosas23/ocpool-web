'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PrivateBlockingState, PrivateButton, PrivateSelect, PrivateSurfaceRoot, PrivateTextArea, PrivateTextField } from '@/components/private/ui';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { getOrCreateIdempotencyKey } from '@/lib/idempotency-key';
import {
  QUOTE_REQUEST_BUDGET_RANGES,
  QUOTE_REQUEST_BUDGET_RANGE_LABELS,
  QUOTE_REQUEST_PROJECT_STAGES,
  QUOTE_REQUEST_PROJECT_STAGE_LABELS,
  QUOTE_REQUEST_TIMELINES,
  QUOTE_REQUEST_TIMELINE_LABELS,
} from '@/server/modules/quote-requests/domain';

type FormState = {
  displayName: string;
  email: string;
  phone: string;
  roleTitle: string;
  projectType: string;
  location: string;
  projectStage: string;
  dimensions: string;
  timeline: string;
  budgetRange: string;
  description: string;
  consent: boolean;
};

type ContactMatch = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  roleTitle: string | null;
  client: { id: string; displayName: string; status: string };
};

type CreateResponse = { accepted: true; quoteRequestId: string; folio: string; clientId: string; contactId: string };
type ErrorResponse = { error?: { message?: string; requestId?: string } };

const INITIAL_FORM: FormState = {
  displayName: '', email: '', phone: '', roleTitle: '', projectType: '', location: '', projectStage: '', dimensions: '', timeline: '', budgetRange: '', description: '', consent: false,
};

function readResponse<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({})).then((data: T & ErrorResponse) => {
    if (!response.ok) throw new Error(getApiErrorMessage(data, 'No fue posible completar la solicitud.'));
    return data as T;
  });
}

export default function StaffRequestCreateV2Panel() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [matches, setMatches] = useState<ContactMatch[] | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [confirmNewContact, setConfirmNewContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState<string | null>(null);

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setCreateIdempotencyKey(null);
    if (field === 'email' || field === 'phone') {
      setMatches(null);
      setSelectedMatchId('');
      setConfirmNewContact(false);
    }
  };

  const canSubmit = useMemo(() => Boolean(form.displayName.trim() && form.email.trim() && form.projectType.trim() && form.location.trim() && form.description.trim().length >= 10 && form.consent), [form]);

  const createRequest = async (useNewContact: boolean, contactMatchId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = getOrCreateIdempotencyKey(createIdempotencyKey, 'staff-create');
      setCreateIdempotencyKey(idempotencyKey);
      const response = await fetch('/api/staff/quote-requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          ...form,
          phone: form.phone || null,
          roleTitle: form.roleTitle || null,
          projectStage: form.projectStage || null,
          dimensions: form.dimensions || null,
          timeline: form.timeline || null,
          budgetRange: form.budgetRange || null,
          contactMatchId,
          confirmNewContact: useNewContact,
        }),
      });
      const created = await readResponse<CreateResponse>(response);
      router.replace(`/staff/requests/${encodeURIComponent(created.quoteRequestId)}?tab=summary&created=1`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible crear la solicitud.');
    } finally {
      setBusy(false);
    }
  };

  const lookupOrCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    if (matches && selectedMatchId) {
      await createRequest(false, selectedMatchId);
      return;
    }
    if (matches && confirmNewContact) {
      await createRequest(true, null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ email: form.email.trim() });
      if (form.phone.trim()) params.set('phone', form.phone.trim());
      const response = await fetch(`/api/staff/quote-requests/matches?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const found = await readResponse<{ items: ContactMatch[] }>(response);
      if (found.items.length > 0) {
        setMatches(found.items);
        setSelectedMatchId('');
        setBusy(false);
        return;
      }
      setBusy(false);
      await createRequest(true, null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible revisar coincidencias.');
      setBusy(false);
    }
  };

  return <PrivateSurfaceRoot className="request-workspace-v2 request-workspace-v2--create">
    <div className="request-workspace-v2__content">
      <Link className="request-workspace-v2__back" href="/staff/requests">← Volver a solicitudes</Link>
      <header className="request-workspace-v2__detail-header"><div><p className="private-kicker">Admisión manual</p><h1>Nueva solicitud</h1><p>Captura lo esencial y confirma cualquier coincidencia antes de crear o reutilizar un contacto.</p></div></header>
      {error && <PrivateBlockingState title="No fue posible continuar.">{error}</PrivateBlockingState>}
      <form className="request-workspace-v2__create-form" onSubmit={lookupOrCreate}>
        <section className="request-workspace-v2__create-section" aria-labelledby="request-contact-title"><p className="private-kicker">Contacto</p><h2 id="request-contact-title">Datos de contacto</h2><div className="request-workspace-v2__create-grid"><PrivateTextField id="staff-request-name" label="Nombre completo" value={form.displayName} onChange={(event) => update('displayName', event.target.value)} required autoComplete="name" /><PrivateTextField id="staff-request-email" label="Correo" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} required autoComplete="email" /><PrivateTextField id="staff-request-phone" label="Teléfono" value={form.phone} onChange={(event) => update('phone', event.target.value)} autoComplete="tel" /><PrivateTextField id="staff-request-role" label="Cargo o rol" value={form.roleTitle} onChange={(event) => update('roleTitle', event.target.value)} /></div></section>
        <section className="request-workspace-v2__create-section" aria-labelledby="request-project-title"><p className="private-kicker">Proyecto</p><h2 id="request-project-title">Contexto inicial</h2><div className="request-workspace-v2__create-grid"><PrivateTextField id="staff-request-project" label="Tipo de proyecto" value={form.projectType} onChange={(event) => update('projectType', event.target.value)} required /><PrivateTextField id="staff-request-location" label="Ubicación" value={form.location} onChange={(event) => update('location', event.target.value)} required /><PrivateSelect id="staff-request-stage" label="Etapa del proyecto" value={form.projectStage} options={QUOTE_REQUEST_PROJECT_STAGES.map((value) => ({ value, label: QUOTE_REQUEST_PROJECT_STAGE_LABELS[value] }))} onValueChange={(value) => update('projectStage', value)} placeholder="Por definir" /><PrivateSelect id="staff-request-timeline" label="Horizonte" value={form.timeline} options={QUOTE_REQUEST_TIMELINES.map((value) => ({ value, label: QUOTE_REQUEST_TIMELINE_LABELS[value] }))} onValueChange={(value) => update('timeline', value)} placeholder="Por definir" /><PrivateSelect id="staff-request-budget" label="Presupuesto orientativo" value={form.budgetRange} options={QUOTE_REQUEST_BUDGET_RANGES.map((value) => ({ value, label: QUOTE_REQUEST_BUDGET_RANGE_LABELS[value] }))} onValueChange={(value) => update('budgetRange', value)} placeholder="Por definir" /><PrivateTextField id="staff-request-dimensions" label="Dimensiones" value={form.dimensions} onChange={(event) => update('dimensions', event.target.value)} /></div><PrivateTextArea id="staff-request-description" label="Descripción" value={form.description} onChange={(event) => update('description', event.target.value)} required rows={6} /><label className="request-workspace-v2__consent"><input type="checkbox" checked={form.consent} onChange={(event) => update('consent', event.target.checked)} /><span>El cliente autorizó registrar esta solicitud y ser contactado por OCPOOL.</span></label></section>
        {matches && <section className="request-workspace-v2__matches" aria-labelledby="request-matches-title"><p className="private-kicker">Dedupe</p><h2 id="request-matches-title">Encontramos {matches.length} contacto{matches.length === 1 ? '' : 's'} coincidente{matches.length === 1 ? '' : 's'}.</h2><p>Selecciona un contacto existente o confirma de forma explícita que debe crearse un cliente nuevo. No se combinan perfiles automáticamente.</p><fieldset><legend>Contactos posibles</legend>{matches.map((match) => <label className="request-workspace-v2__match" key={match.id}><input type="radio" name="contact-match" value={match.id} checked={selectedMatchId === match.id} onChange={() => { setSelectedMatchId(match.id); setConfirmNewContact(false); }} /><span><strong>{match.displayName}</strong><small>{match.email} · Cliente: {match.client.displayName}</small></span></label>)}</fieldset><label className="request-workspace-v2__consent"><input type="checkbox" checked={confirmNewContact} onChange={(event) => { setConfirmNewContact(event.target.checked); if (event.target.checked) setSelectedMatchId(''); }} /><span>Confirmo crear un cliente nuevo aunque exista una coincidencia.</span></label></section>}
        <div className="request-workspace-v2__create-actions"><PrivateButton type="submit" variant="primary" disabled={!canSubmit || busy}>{busy ? 'Revisando…' : matches && selectedMatchId ? 'Usar contacto seleccionado' : matches && confirmNewContact ? 'Crear cliente nuevo' : 'Revisar y crear solicitud'}</PrivateButton><Link className="private-button private-button--quiet" href="/staff/requests">Cancelar</Link></div>
      </form>
    </div>
  </PrivateSurfaceRoot>;
}
