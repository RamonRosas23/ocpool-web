'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PrivateDialog } from '@/components/private/ui';
import { changeRequestBody } from '@/lib/change-request';
import { DECLINE_REASONS, type DeclineReasonCode } from '@/lib/decline-request';
import { formatDateTime } from '@/lib/format-date';

type QuoteVersionActionData = Readonly<{
  id: string;
  versionNumber: number;
  termsVersion: string;
  termsLabel: string;
  status: string;
  validUntil: string | null;
  pdfReady: boolean;
  declinedAt?: string | null;
}>;

type ErrorResponse = { error?: { message?: string } };

type Props = Readonly<{
  quoteId: string;
  requestId: string;
  version: QuoteVersionActionData;
  /** Estado del expediente: uno cerrado o ya fuera de negociación no admite aceptación aunque la versión siga "enviada". */
  requestStatus: string;
  validity: { label: string; expired: boolean };
  contactDisplayName: string;
  onAccepted: () => void;
  onChangeRequested: () => void;
  onDeclined: () => void;
  onRequestNewVersion: () => void;
}>;

// Mismos estados de expediente que acepta el servidor: ofrecer "Revisar y aceptar" fuera de ellos
// terminaba en un error al final del diálogo.
const ACCEPTABLE_REQUEST_STATUSES = new Set(['COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION']);

function acceptanceIsAvailable(version: QuoteVersionActionData, validity: Props['validity'], requestStatus: string): boolean {
  return version.pdfReady && (version.status === 'ENVIADA' || version.status === 'EN_NEGOCIACION') && !validity.expired && ACCEPTABLE_REQUEST_STATUSES.has(requestStatus);
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(data.error?.message ?? 'No fue posible completar esta acción.');
  return data as T;
}

function createIdempotencyKey(): string {
  return `portal-quote-${Date.now()}-${globalThis.crypto.randomUUID()}`;
}

export default function ClientQuoteActions({ quoteId, requestId, version, requestStatus, validity, contactDisplayName, onAccepted, onChangeRequested, onDeclined, onRequestNewVersion }: Props) {
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
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState<DeclineReasonCode | null>(null);
  const [declineComment, setDeclineComment] = useState('');
  const [declineSending, setDeclineSending] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [declineSent, setDeclineSent] = useState(false);
  const signerInputRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const declineIdempotencyKeyRef = useRef<string | null>(null);
  const versionIdRef = useRef(version.id);
  useEffect(() => { versionIdRef.current = version.id; }, [version.id]);

  // Si el servidor publica una versión nueva mientras el panel sigue montado, la vista previa
  // cacheada de la anterior no debe reaparecer bajo el mismo componente.
  useEffect(() => {
    setPreviewUrl(null);
    declineIdempotencyKeyRef.current = null;
    setDeclineDialogOpen(false);
    setDeclineReason(null);
    setDeclineComment('');
    setDeclineError(null);
    setDeclineSent(false);
  }, [version.id]);

  // En pantallas táctiles muchos navegadores (Chrome en Android) no muestran un PDF dentro de un
  // iframe: ahí se ofrece abrirlo en el visor del teléfono en vez de un recuadro que no carga.
  const [touchPreview, setTouchPreview] = useState(false);
  useEffect(() => { setTouchPreview(window.matchMedia('(pointer: coarse)').matches); }, []);

  // Revisar el PDF sin salir de la página: se incrusta la misma URL firmada que ya usa la descarga,
  // en vez de obligar a abrir una pestaña nueva antes de poder decidir.
  //
  // UX audit fix: este componente no se remonta al cambiar de expediente en el portal (no lleva
  // `key` en ClientPortalPanel.tsx) -- si el cliente abre este diálogo, cambia a otro expediente
  // antes de que la vista previa resuelva y el diálogo sigue abierto (su estado `dialogOpen` vive
  // en la misma instancia), la respuesta tardía podía aplicarse igual, mostrando el PDF de una
  // propuesta distinta a la que el diálogo dice estar mostrando -- grave en un flujo de aceptación
  // vinculante. `versionIdRef` siempre refleja la versión vigente; sólo se aplica la respuesta si
  // la versión solicitada sigue siendo la vigente cuando la petición resuelve.
  const loadPreview = async () => {
    if (previewUrl || previewLoading) return;
    const requestedVersionId = version.id;
    setPreviewLoading(true);
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}/pdf?versionId=${encodeURIComponent(requestedVersionId)}&disposition=inline`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<{ downloadUrl: string }>(response);
      if (versionIdRef.current === requestedVersionId) setPreviewUrl(data.downloadUrl);
    } catch (caught) {
      if (versionIdRef.current === requestedVersionId) setAcceptanceError(caught instanceof Error ? caught.message : 'No fue posible cargar la vista previa del PDF.');
    } finally {
      // `previewLoading` se limpia siempre, sin importar si la respuesta era de una versión ya
      // obsoleta -- de lo contrario una respuesta tardía dejaría el guardado `if (previewUrl ||
      // previewLoading) return;` bloqueado para siempre, impidiendo que la versión vigente cargue
      // su propia vista previa cuando el diálogo se reabra.
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
    if (!touchPreview) void loadPreview();
  };

  // Abre el PDF en el visor del dispositivo. La pestaña se abre dentro del gesto del usuario (Safari
  // bloquea window.open después de un await) y luego recibe la URL firmada, que dura poco.
  const openPdfInViewer = async () => {
    const viewer = window.open('', '_blank');
    if (viewer) viewer.opener = null;
    setPdfError(null);
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}/pdf?versionId=${encodeURIComponent(version.id)}&disposition=inline`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<{ downloadUrl: string }>(response);
      // El enlace es una ruta del propio sitio: se resuelve aquí para que la pestaña nueva (about:blank)
      // no dependa de cómo cada navegador interpreta una ruta relativa.
      const url = new URL(data.downloadUrl, window.location.href).toString();
      if (viewer) viewer.location.href = url;
      else window.location.assign(url);
    } catch (caught) {
      viewer?.close();
      setAcceptanceError(caught instanceof Error ? caught.message : 'No fue posible abrir el PDF.');
    }
  };

  const downloadPdf = async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}/pdf?versionId=${encodeURIComponent(version.id)}`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<{ downloadUrl: string }>(response);
      // La URL firmada ya pide descargar: un enlace en la misma pestaña guarda el archivo sin dejar
      // una pestaña en blanco (y sin depender de ventanas emergentes).
      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
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
  //
  // UX audit fix: ese "igual peso" no se veía reflejado visualmente -- el botón principal usaba la
  // misma clase `--quiet` que "Cancelar" dentro de los diálogos (una acción de salida menor de
  // verdad), leyéndose como la opción secundaria frente a "Revisar y aceptar". Ahora usa
  // `--secondary` (contorno grueso, sin relleno) -- presente sin competir con el primario, distinto
  // del tratamiento apagado de un botón de cancelar.
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
          body: changeRequestBody(version.versionNumber, changeMessage),
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

  const openDeclineDialog = () => {
    if (!declineIdempotencyKeyRef.current) declineIdempotencyKeyRef.current = `portal-decline-${requestId}-${version.id}-${globalThis.crypto.randomUUID()}`;
    setDeclineReason(null);
    setDeclineComment('');
    setDeclineError(null);
    setDeclineSent(false);
    setDeclineDialogOpen(true);
  };

  const submitDecline = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!declineReason || (declineReason === 'OTHER' && !declineComment.trim())) return;
    setDeclineSending(true);
    setDeclineError(null);
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}/decline`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          versionId: version.id,
          reason: declineReason,
          comment: declineComment,
          idempotencyKey: declineIdempotencyKeyRef.current ?? `portal-decline-${requestId}-${version.id}-${globalThis.crypto.randomUUID()}`,
        }),
      });
      await readResponse(response);
      declineIdempotencyKeyRef.current = null;
      setDeclineSent(true);
      onDeclined();
    } catch (caught) {
      // Conserva la llave: si el servidor confirmó pero la respuesta se perdió, el reintento es seguro.
      setDeclineError(caught instanceof Error ? caught.message : 'No fue posible enviar tu respuesta.');
    } finally {
      setDeclineSending(false);
    }
  };

  const submitAcceptance = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!signerName.trim()) {
      setAcceptanceError('Escribe tu nombre completo para continuar.');
      return;
    }
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

  const available = acceptanceIsAvailable(version, validity, requestStatus);
  const declineAvailable = version.pdfReady
    && (version.status === 'ENVIADA' || version.status === 'EN_NEGOCIACION')
    && !validity.expired
    && (requestStatus === 'COTIZACION_DISPONIBLE' || requestStatus === 'EN_NEGOCIACION');
  const alreadyAccepted = version.status === 'ACEPTADA';
  // Retirada: el equipo cerró el expediente (o esta versión). Pedir cambios sobre ella no tiene sentido;
  // la vía para retomarlo es la conversación.
  const retired = version.status === 'RECHAZADA' || requestStatus === 'RECHAZADA';

  return <>
    <div className="client-quote-actions" aria-label={`Acciones para la versión ${version.versionNumber}`}>
      {version.pdfReady
        ? <button className="client-quote-action client-quote-action--quiet" type="button" onClick={() => void downloadPdf()} disabled={pdfLoading}>
          {pdfLoading ? 'Preparando PDF…' : 'Descargar PDF'}
        </button>
        : <span className="client-quote-action-state client-quote-action-state--muted">PDF en preparación</span>}
      {!alreadyAccepted && !retired && <button className="client-quote-action client-quote-action--secondary" type="button" onClick={openChangeDialog}>Solicitar cambios</button>}
      {declineAvailable && <button className="client-quote-action client-quote-action--secondary" type="button" onClick={openDeclineDialog}>No me interesa esta propuesta</button>}
      {available && <button className="client-quote-action client-quote-action--primary" type="button" onClick={openDialog}>Revisar y aceptar</button>}
      {alreadyAccepted && <span className="client-quote-action-state" role="status"><i aria-hidden="true" />Aceptada</span>}
      {/* UX audit fix: RECHAZADA es un estado real y visible para el cliente (CUSTOMER_VISIBLE_QUOTE_VERSION_STATUSES
          en customer-visibility.ts lo incluye explícitamente), pero ninguna de las ramas anteriores lo cubría --
          el cliente no veía ningún estado ni explicación, sólo "Descargar PDF"/"Solicitar cambios" sin contexto.
          Se revisa antes que `validity.expired` porque ambas condiciones pueden ser ciertas a la vez (una versión
          rechazada también puede tener su fecha de vigencia ya pasada) y el motivo real es el rechazo, no la fecha. */}
      {version.declinedAt && <span className="client-quote-action-state client-quote-action-state--muted" role="status">Declinaste esta propuesta el {formatDateTime(version.declinedAt)}.</span>}
      {!available && !alreadyAccepted && retired && !version.declinedAt && <span className="client-quote-action-state client-quote-action-state--muted">Esta versión ya no está vigente. Si quieres retomarla, escríbenos en la conversación.</span>}
      {!available && !alreadyAccepted && !retired && (validity.expired || requestStatus === 'VENCIDA') && <span className="client-quote-action-state client-quote-action-state--muted">Propuesta vencida. Solicita cambios para recibir una versión actualizada.</span>}
    </div>
    {pdfError && <p className="client-quote-action-error" role="alert">{pdfError}</p>}
    <PrivateDialog open={dialogOpen} onClose={() => { if (!accepting) setDialogOpen(false); }} className="client-accept-dialog" overlayClassName="client-accept-overlay" labelledBy="client-accept-title" describedBy="client-accept-description" initialFocusRef={signerInputRef}>
      <div className="client-accept-dialog__head"><div><p className="client-eyebrow">Decisión sobre tu propuesta</p><h2 id="client-accept-title">Aceptar versión {version.versionNumber}</h2></div><button className="client-accept-dialog__close" type="button" onClick={() => setDialogOpen(false)} disabled={accepting} aria-label="Cerrar aceptación"><X size={20} aria-hidden="true" /></button></div>
      {accepted ? <div className="client-accept-success" role="status"><span className="client-accept-success__mark" aria-hidden="true">✓</span><h3>Propuesta aceptada.</h3><p>Tu proyecto quedó en marcha: el equipo te contactará para coordinar el arranque. Conserva el PDF para tus archivos.</p><button className="client-quote-action client-quote-action--primary" type="button" onClick={() => { setDialogOpen(false); onAccepted(); }}>Continuar</button></div> : <form onSubmit={submitAcceptance}>
        <p id="client-accept-description" className="client-accept-dialog__copy">{touchPreview ? 'Revisa el PDF' : 'Revisa el PDF aquí mismo'} y confirma que deseas avanzar con esta propuesta. Esta acción fija la versión aceptada y no permite modificarla.</p>
        <div className="client-accept-preview" aria-label="Vista previa del PDF">
          {touchPreview ? <div className="client-accept-preview__touch"><p>Abre la propuesta en el visor de PDF de tu teléfono, revísala y regresa aquí para confirmar.</p><button className="client-quote-action client-quote-action--secondary" type="button" onClick={() => void openPdfInViewer()}>Abrir PDF de la versión {version.versionNumber}</button></div> : <>
          {previewLoading && <div className="client-accept-preview__loading" role="status">Cargando vista previa…</div>}
          {!previewLoading && previewUrl && <iframe src={previewUrl} title={`Propuesta versión ${version.versionNumber}`} />}
          {!previewLoading && !previewUrl && <div className="client-accept-preview__loading">No fue posible mostrar la vista previa; usa &quot;Descargar PDF&quot;.</div>}
          </>}
        </div>
        <label className="client-accept-field"><span>Nombre de quien acepta</span><input ref={signerInputRef} value={signerName} onChange={(event) => setSignerName(event.target.value)} autoComplete="name" maxLength={180} placeholder="Escribe tu nombre completo" /></label>
        <label className="client-accept-check"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>Confirmo que revisé la propuesta, el PDF y las condiciones comerciales de la versión {version.versionNumber}.</span></label>
        <p className="client-accept-terms">{version.termsLabel}</p>
        {acceptanceError && <p className="client-quote-action-error" role="alert">{acceptanceError}</p>}
        <div className="client-accept-dialog__actions"><button className="client-quote-action client-quote-action--quiet" type="button" onClick={() => setDialogOpen(false)} disabled={accepting}>Cancelar</button><button className="client-quote-action client-quote-action--primary" type="submit" disabled={accepting}>{accepting ? 'Registrando…' : 'Aceptar propuesta'}</button></div>
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
    <PrivateDialog open={declineDialogOpen} onClose={() => { if (!declineSending) setDeclineDialogOpen(false); }} className="client-accept-dialog" overlayClassName="client-accept-overlay" labelledBy="client-decline-title" describedBy="client-decline-description">
      <div className="client-accept-dialog__head"><div><p className="client-eyebrow">Respuesta a tu propuesta</p><h2 id="client-decline-title">Declinar versión {version.versionNumber}</h2></div><button className="client-accept-dialog__close" type="button" onClick={() => setDeclineDialogOpen(false)} disabled={declineSending} aria-label="Cerrar respuesta"><X size={20} aria-hidden="true" /></button></div>
      {declineSent ? <div className="client-accept-success" role="status"><span className="client-accept-success__mark" aria-hidden="true">✓</span><h3>Tu respuesta fue enviada.</h3><p>Tu asesor recibió tu respuesta y podrá prepararte otra versión.</p><button className="client-quote-action client-quote-action--primary" type="button" onClick={() => { setDeclineDialogOpen(false); onRequestNewVersion(); }}>Ir a la conversación</button></div> : <form onSubmit={submitDecline}>
        <p id="client-decline-description" className="client-accept-dialog__copy">Elige el motivo que mejor describe tu decisión. Tu asesor recibirá tu respuesta y podrá prepararte otra versión.</p>
        <fieldset className="client-decline-options"><legend>¿Por qué no te interesa esta propuesta?</legend>{DECLINE_REASONS.map(({ code, label }) => <label key={code}><input type="radio" name="decline-reason" value={code} checked={declineReason === code} onChange={() => setDeclineReason(code)} required /><span>{label}</span></label>)}</fieldset>
        <label className="client-accept-field"><span>Comentario (opcional)</span><textarea value={declineComment} onChange={(event) => setDeclineComment(event.target.value)} maxLength={1000} rows={3} required={declineReason === 'OTHER'} placeholder="Si quieres, agrega un detalle para tu asesor…" /></label>
        {declineError && <p className="client-quote-action-error" role="alert">{declineError}</p>}
        <div className="client-accept-dialog__actions"><button className="client-quote-action client-quote-action--quiet" type="button" onClick={() => setDeclineDialogOpen(false)} disabled={declineSending}>Cancelar</button><button className="client-quote-action client-quote-action--primary" type="submit" disabled={declineSending || !declineReason || (declineReason === 'OTHER' && !declineComment.trim())}>{declineSending ? 'Enviando…' : 'Declinar propuesta'}</button></div>
      </form>}
    </PrivateDialog>
  </>;
}
