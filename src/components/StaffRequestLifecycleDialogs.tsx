'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PrivateDialog, PrivateSelect } from '@/components/private/ui';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import { getOrCreateIdempotencyKey } from '@/lib/idempotency-key';
import { QUOTE_REQUEST_CLOSE_REASON_LABELS, QUOTE_REQUEST_CLOSE_REASONS } from '@/server/modules/quote-requests/domain';

/**
 * Cerrar un expediente con motivo, desde cualquier etapa abierta. Si hay una propuesta enviada, el
 * servidor la retira en la misma operación: aquí se avisa antes de confirmar.
 */
export function CloseRequestDialog({ open, requestId, folio, sentVersionNumber, onClose, onClosed }: {
  open: boolean;
  requestId: string;
  folio: string;
  sentVersionNumber: number | null;
  onClose: () => void;
  onClosed: (message: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setNote('');
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!reason) { setError('Elige el motivo del cierre.'); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${encodeURIComponent(requestId)}/close`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, ...(note.trim() ? { note: note.trim() } : {}) }) });
      await readApiResponseOrThrow(response, 'No fue posible cerrar el expediente.');
      await onClosed(sentVersionNumber ? `Expediente cerrado. La propuesta V${sentVersionNumber} se retiró del portal del cliente.` : 'Expediente cerrado. Puedes reabrirlo cuando lo necesites.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cerrar el expediente.');
    } finally {
      setBusy(false);
    }
  };

  return <PrivateDialog open={open} onClose={() => { if (!busy) onClose(); }} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="request-close-title" describedBy="request-close-description">
    <div className="quotes-preflight-dialog__head"><h3 id="request-close-title">Cerrar {folio}</h3><button className="staff-dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
    <p id="request-close-description" className="quotes-preflight-dialog__copy">El expediente sale de las bandejas de trabajo con su motivo en el historial. Si el cliente vuelve, se reabre desde el mismo expediente.</p>
    {sentVersionNumber && <p className="staff-request-edit__impact is-sensitive">La propuesta V{sentVersionNumber} enviada se retirará: el cliente ya no podrá aceptarla desde su portal.</p>}
    <div className="staff-lifecycle-dialog__fields">
      <PrivateSelect id="request-close-reason" label="Motivo del cierre" required value={reason} onValueChange={setReason} options={QUOTE_REQUEST_CLOSE_REASONS.map((value) => ({ value, label: QUOTE_REQUEST_CLOSE_REASON_LABELS[value] }))} placeholder="Elige un motivo" />
      <label className="quotes-preflight-field"><span>Nota (opcional)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={400} rows={3} placeholder="Por ejemplo: construirá hasta el próximo año; eligió otra empresa por precio." /></label>
    </div>
    {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
    <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="staff-button staff-button--danger" type="button" disabled={busy || !reason} onClick={() => void submit()}>{busy ? 'Cerrando…' : 'Cerrar expediente'}</button></div>
  </PrivateDialog>;
}

export type FollowUpKind = 'information' | 'proposal';

function followUpDraft(kind: FollowUpKind, contactName: string, folio: string, detail: { missing: readonly string[]; versionNumber: number | null }): string {
  const greeting = contactName.trim() ? `Hola ${contactName.trim()},` : 'Hola,';
  if (kind === 'information') {
    const missing = detail.missing.length ? `: ${detail.missing.join(', ')}` : '';
    return `${greeting} te escribimos para dar seguimiento a los datos que te pedimos para preparar tu cotización ${folio}${missing}.\n\n¿Nos los compartes respondiendo a este mensaje? Si prefieres, dinos a qué hora te podemos llamar.`;
  }
  const version = detail.versionNumber ? ` (versión ${detail.versionNumber})` : '';
  return `${greeting} te escribimos para saber si pudiste revisar la propuesta ${folio}${version}.\n\nSi tienes dudas o quieres ajustar algo, respóndenos aquí o desde tu portal y con gusto preparamos una nueva versión.`;
}

/**
 * "¿Qué pasa si se queda en un proceso?": un clic arma el mensaje de seguimiento (datos pendientes o
 * propuesta sin respuesta); se revisa, se ajusta y se envía al cliente por correo y a su portal.
 */
export function FollowUpDialog({ open, kind, requestId, folio, contactName, missing, versionNumber, onClose, onSent }: {
  open: boolean;
  kind: FollowUpKind;
  requestId: string;
  folio: string;
  contactName: string;
  missing: readonly string[];
  versionNumber: number | null;
  onClose: () => void;
  onSent: (message: string) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBody(followUpDraft(kind, contactName, folio, { missing, versionNumber }));
    setError(null);
    setIdempotencyKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el borrador se arma al abrir
  }, [open]);

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const key = getOrCreateIdempotencyKey(idempotencyKey, 'follow-up');
      setIdempotencyKey(key);
      const response = await fetch(`/api/staff/quote-requests/${encodeURIComponent(requestId)}/messages`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: body.trim(), idempotencyKey: key }) });
      await readApiResponseOrThrow(response, 'No fue posible enviar el seguimiento.');
      await onSent('Seguimiento enviado: el cliente lo recibe por correo y en su portal.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible enviar el seguimiento.');
    } finally {
      setBusy(false);
    }
  };

  return <PrivateDialog open={open} onClose={() => { if (!busy) onClose(); }} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="request-follow-up-title" describedBy="request-follow-up-description">
    <div className="quotes-preflight-dialog__head"><h3 id="request-follow-up-title">Dar seguimiento a {folio}</h3><button className="staff-dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
    <p id="request-follow-up-description" className="quotes-preflight-dialog__copy">Te propusimos un mensaje; ajústalo si quieres. El cliente lo recibe por correo y queda en la conversación del expediente.</p>
    <label className="quotes-preflight-field"><span>Mensaje para {contactName || 'el cliente'}</span><textarea className="staff-lifecycle-dialog__message" value={body} onChange={(event) => setBody(event.target.value)} maxLength={10000} rows={7} /></label>
    {error && <p className="staff-request-edit__error" role="alert">{error}</p>}
    <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="staff-button staff-button--dark" type="button" disabled={busy || !body.trim()} onClick={() => void submit()}>{busy ? 'Enviando…' : 'Enviar seguimiento'}</button></div>
  </PrivateDialog>;
}
