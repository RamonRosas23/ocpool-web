'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PrivateDialog } from '@/components/private/ui';

type QuoteVersionActionData = Readonly<{
  id: string;
  versionNumber: number;
  termsVersion: string;
  termsLabel: string;
  status: string;
  validUntil: string | null;
  pdfReady: boolean;
}>;

type ErrorResponse = { error?: { message?: string } };

type Props = Readonly<{
  quoteId: string;
  requestId: string;
  version: QuoteVersionActionData;
  validity: { label: string; expired: boolean };
  contactDisplayName: string;
  onAccepted: () => void;
  onChangeRequested: () => void;
}>;

function acceptanceIsAvailable(version: QuoteVersionActionData, validity: Props['validity']): boolean {
  return version.pdfReady && (version.status === 'ENVIADA' || version.status === 'EN_NEGOCIACION') && !validity.expired;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(data.error?.message ?? 'No fue posible completar esta acción.');
  return data as T;
}

function createIdempotencyKey(): string {
  return `portal-quote-${Date.now()}-${globalThis.crypto.randomUUID()}`;
}

export default function ClientQuoteActions({ quoteId, requestId, version, validity, contactDisplayName, onAccepted, onChangeRequested }: Props) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // El firmante ya es un contacto autenticado conocido; precargar su nombre evita que tenga que
  // volver a teclearlo para el caso común (sigue siendo editable si acepta alguien más autorizado).
  const [signerName, setSignerName] = useState(contactDisplayName);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const signerInputRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  // Si el servidor publica una versión nueva mientras el panel sigue montado, la vista previa
  // cacheada de la anterior no debe reaparecer bajo el mismo componente.
  useEffect(() => { setPreviewUrl(null); }, [version.id]);

  // Revisar el PDF sin salir de la página: se incrusta la misma URL firmada que ya usa la descarga,
  // en vez de obligar a abrir una pestaña nueva antes de poder decidir.
  const loadPreview = async () => {
    if (previewUrl || previewLoading) return;
    setPreviewLoading(true);
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}/pdf?versionId=${encodeURIComponent(version.id)}`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<{ downloadUrl: string }>(response);
      setPreviewUrl(data.downloadUrl);
    } catch (caught) {
      setAcceptanceError(caught instanceof Error ? caught.message : 'No fue posible cargar la vista previa del PDF.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const openDialog = () => {
    setAcceptanceError(null);
    setAccepted(false);
    setTermsAccepted(false);
    setSignerName(contactDisplayName);
    setPreviewUrl(null);
    idempotencyKeyRef.current = createIdempotencyKey();
    setDialogOpen(true);
    void loadPreview();
  };

  const downloadPdf = async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}/pdf?versionId=${encodeURIComponent(version.id)}`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<{ downloadUrl: string }>(response);
      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setPdfError(caught instanceof Error ? caught.message : 'No fue posible abrir el PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  // C1-04: "Solicitar cambios" es una decisión de igual peso que aceptar, no un mensaje suelto que
  // haya que escribir sin guía dentro del chat general. Reutiliza la mensajería ya existente en vez
  // de inventar un dominio nuevo: nunca edita, rechaza ni oculta la propuesta, sólo la deja intacta
  // y avisa a staff con un mensaje identificable como petición de cambios.
  const [changeMessage, setChangeMessage] = useState('');
  const [changeSending, setChangeSending] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSent, setChangeSent] = useState(false);

  const openChangeDialog = () => {
    setChangeMessage('');
    setChangeError(null);
    setChangeSent(false);
    setChangeDialogOpen(true);
  };

  const submitChangeRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!changeMessage.trim()) return;
    setChangeSending(true);
    setChangeError(null);
    try {
      const response = await fetch(`/api/portal/requests/${requestId}/messages`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: `Solicitud de cambios en la propuesta V${version.versionNumber}:\n\n${changeMessage.trim()}`,
          idempotencyKey: `portal-change-request-${requestId}-${version.id}-${Date.now()}`,
        }),
      });
      await readResponse(response);
      setChangeSent(true);
      onChangeRequested();
    } catch (caught) {
      setChangeError(caught instanceof Error ? caught.message : 'No fue posible enviar tu solicitud.');
    } finally {
      setChangeSending(false);
    }
  };

  const submitAcceptance = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!termsAccepted) {
      setAcceptanceError('Confirma que revisaste la propuesta y sus condiciones.');
      return;
    }
    setAccepting(true);
    setAcceptanceError(null);
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}/accept`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signerName, termsVersion: version.termsVersion, idempotencyKey: idempotencyKeyRef.current ?? createIdempotencyKey() }),
      });
      await readResponse(response);
      setAccepted(true);
    } catch (caught) {
      setAcceptanceError(caught instanceof Error ? caught.message : 'No fue posible registrar la aceptación.');
    } finally {
      setAccepting(false);
    }
  };

  const available = acceptanceIsAvailable(version, validity);
  const alreadyAccepted = version.status === 'ACEPTADA';

  return <>
    <div className="client-quote-actions" aria-label={`Acciones para la versión ${version.versionNumber}`}>
      {version.pdfReady
        ? <button className="client-quote-action client-quote-action--quiet" type="button" onClick={() => void downloadPdf()} disabled={pdfLoading}>
          {pdfLoading ? 'Preparando PDF…' : 'Descargar PDF'}
        </button>
        : <span className="client-quote-action-state client-quote-action-state--muted">PDF en preparación</span>}
      {!alreadyAccepted && <button className="client-quote-action client-quote-action--quiet" type="button" onClick={openChangeDialog}>Solicitar cambios</button>}
      {available && <button className="client-quote-action client-quote-action--primary" type="button" onClick={openDialog}>Revisar y aceptar</button>}
      {alreadyAccepted && <span className="client-quote-action-state" role="status"><i aria-hidden="true" />Aceptada</span>}
      {!available && !alreadyAccepted && validity.expired && <span className="client-quote-action-state client-quote-action-state--muted">Propuesta vencida. Solicita cambios para recibir una versión actualizada.</span>}
    </div>
    {pdfError && <p className="client-quote-action-error" role="alert">{pdfError}</p>}
    <PrivateDialog open={dialogOpen} onClose={() => { if (!accepting) setDialogOpen(false); }} className="client-accept-dialog" overlayClassName="client-accept-overlay" labelledBy="client-accept-title" describedBy="client-accept-description" initialFocusRef={signerInputRef}>
      <div className="client-accept-dialog__head"><div><p className="client-eyebrow">Decisión sobre tu propuesta</p><h2 id="client-accept-title">Aceptar versión {version.versionNumber}</h2></div><button className="client-accept-dialog__close" type="button" onClick={() => setDialogOpen(false)} disabled={accepting} aria-label="Cerrar aceptación"><X size={20} aria-hidden="true" /></button></div>
      {accepted ? <div className="client-accept-success" role="status"><span className="client-accept-success__mark" aria-hidden="true">✓</span><h3>Propuesta aceptada.</h3><p>La aceptación quedó registrada y tu expediente se actualizó. Conserva el PDF para tus archivos.</p><button className="client-quote-action client-quote-action--primary" type="button" onClick={() => { setDialogOpen(false); onAccepted(); }}>Continuar</button></div> : <form onSubmit={submitAcceptance}>
        <p id="client-accept-description" className="client-accept-dialog__copy">Revisa el PDF aquí mismo y confirma que deseas avanzar con esta propuesta. Esta acción fija la versión aceptada y no permite modificarla.</p>
        <div className="client-accept-preview" aria-label="Vista previa del PDF">
          {previewLoading && <div className="client-accept-preview__loading" role="status">Cargando vista previa…</div>}
          {!previewLoading && previewUrl && <iframe src={previewUrl} title={`Propuesta versión ${version.versionNumber}`} />}
          {!previewLoading && !previewUrl && <div className="client-accept-preview__loading">No fue posible mostrar la vista previa; usa &quot;Descargar PDF&quot;.</div>}
        </div>
        <label className="client-accept-field"><span>Nombre de quien acepta</span><input ref={signerInputRef} value={signerName} onChange={(event) => setSignerName(event.target.value)} autoComplete="name" maxLength={180} required placeholder="Escribe tu nombre completo" /></label>
        <label className="client-accept-check"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>Confirmo que revisé la propuesta, el PDF y las condiciones comerciales de la versión {version.versionNumber}.</span></label>
        <p className="client-accept-terms">{version.termsLabel}</p>
        {acceptanceError && <p className="client-quote-action-error" role="alert">{acceptanceError}</p>}
        <div className="client-accept-dialog__actions"><button className="client-quote-action client-quote-action--quiet" type="button" onClick={() => setDialogOpen(false)} disabled={accepting}>Cancelar</button><button className="client-quote-action client-quote-action--primary" type="submit" disabled={accepting || !signerName.trim()}>{accepting ? 'Registrando…' : 'Aceptar propuesta'}</button></div>
      </form>}
    </PrivateDialog>
    <PrivateDialog open={changeDialogOpen} onClose={() => { if (!changeSending) setChangeDialogOpen(false); }} className="client-accept-dialog" overlayClassName="client-accept-overlay" labelledBy="client-change-title" describedBy="client-change-description">
      <div className="client-accept-dialog__head"><div><p className="client-eyebrow">Antes de decidir</p><h2 id="client-change-title">Solicitar cambios</h2></div><button className="client-accept-dialog__close" type="button" onClick={() => setChangeDialogOpen(false)} disabled={changeSending} aria-label="Cerrar solicitud de cambios"><X size={20} aria-hidden="true" /></button></div>
      {changeSent ? <div className="client-accept-success" role="status"><span className="client-accept-success__mark" aria-hidden="true">✓</span><h3>Tu solicitud fue enviada.</h3><p>Tu equipo OCPOOL la revisará y te contactará en este mismo expediente para ajustar la propuesta. La versión actual sigue disponible mientras tanto.</p><button className="client-quote-action client-quote-action--primary" type="button" onClick={() => setChangeDialogOpen(false)}>Continuar</button></div> : <form onSubmit={submitChangeRequest}>
        <p id="client-change-description" className="client-accept-dialog__copy">Cuéntanos qué te gustaría ajustar. Esto no cambia ni oculta la propuesta actual; sólo avisa a tu equipo para preparar una nueva versión.</p>
        <label className="client-accept-field"><span>¿Qué te gustaría ajustar?</span><textarea value={changeMessage} onChange={(event) => setChangeMessage(event.target.value)} maxLength={4000} rows={4} required placeholder="Por ejemplo: ajustar el alcance, revisar el presupuesto, cambiar materiales…" /></label>
        {changeError && <p className="client-quote-action-error" role="alert">{changeError}</p>}
        <div className="client-accept-dialog__actions"><button className="client-quote-action client-quote-action--quiet" type="button" onClick={() => setChangeDialogOpen(false)} disabled={changeSending}>Cancelar</button><button className="client-quote-action client-quote-action--primary" type="submit" disabled={changeSending || !changeMessage.trim()}>{changeSending ? 'Enviando…' : 'Enviar solicitud'}</button></div>
      </form>}
    </PrivateDialog>
  </>;
}
