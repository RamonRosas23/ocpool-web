'use client';

import { useEffect, useRef, useState } from 'react';

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
  version: QuoteVersionActionData;
  validity: { label: string; expired: boolean };
  onAccepted: () => void;
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

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex="0"]'));
}

export default function ClientQuoteActions({ quoteId, version, validity, onAccepted }: Props) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const signerInputRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    signerInputRef.current?.focus();
    const dialog = dialogRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !accepting) {
        setDialogOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const elements = focusableElements(dialog);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accepting, dialogOpen]);

  const openDialog = () => {
    setAcceptanceError(null);
    setAccepted(false);
    setTermsAccepted(false);
    idempotencyKeyRef.current = createIdempotencyKey();
    setDialogOpen(true);
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
      {available && <button className="client-quote-action client-quote-action--primary" type="button" onClick={openDialog}>Revisar y aceptar</button>}
      {alreadyAccepted && <span className="client-quote-action-state" role="status"><i aria-hidden="true" />Aceptada</span>}
      {!available && !alreadyAccepted && validity.expired && <span className="client-quote-action-state client-quote-action-state--muted">Propuesta vencida. Escríbenos en la conversación del expediente para solicitar una actualización.</span>}
    </div>
    {pdfError && <p className="client-quote-action-error" role="alert">{pdfError}</p>}
    {dialogOpen && <div className="client-accept-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !accepting) setDialogOpen(false); }}>
      <div className="client-accept-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="client-accept-title" aria-describedby="client-accept-description">
        <div className="client-accept-dialog__head"><div><p className="client-eyebrow">Decisión sobre tu propuesta</p><h2 id="client-accept-title">Aceptar versión {version.versionNumber}</h2></div><button className="client-accept-dialog__close" type="button" onClick={() => setDialogOpen(false)} disabled={accepting} aria-label="Cerrar aceptación">×</button></div>
        {accepted ? <div className="client-accept-success" role="status"><span className="client-accept-success__mark" aria-hidden="true">✓</span><h3>Propuesta aceptada.</h3><p>La aceptación quedó registrada y tu expediente se actualizó. Conserva el PDF para tus archivos.</p><button className="client-quote-action client-quote-action--primary" type="button" onClick={() => { setDialogOpen(false); onAccepted(); }}>Continuar</button></div> : <form onSubmit={submitAcceptance}>
          <p id="client-accept-description" className="client-accept-dialog__copy">Revisa el PDF y confirma que deseas avanzar con esta propuesta. Esta acción fija la versión aceptada y no permite modificarla.</p>
          <label className="client-accept-field"><span>Nombre de quien acepta</span><input ref={signerInputRef} value={signerName} onChange={(event) => setSignerName(event.target.value)} autoComplete="name" maxLength={180} required placeholder="Escribe tu nombre completo" /></label>
          <label className="client-accept-check"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>Confirmo que revisé la propuesta, el PDF y las condiciones comerciales de la versión {version.versionNumber}.</span></label>
          <p className="client-accept-terms">{version.termsLabel}</p>
          {acceptanceError && <p className="client-quote-action-error" role="alert">{acceptanceError}</p>}
          <div className="client-accept-dialog__actions"><button className="client-quote-action client-quote-action--quiet" type="button" onClick={() => setDialogOpen(false)} disabled={accepting}>Cancelar</button><button className="client-quote-action client-quote-action--primary" type="submit" disabled={accepting || !signerName.trim()}>{accepting ? 'Registrando…' : 'Aceptar propuesta'}</button></div>
        </form>}
      </div>
    </div>}
  </>;
}
