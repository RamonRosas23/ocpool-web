'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type DocumentStatus = 'MISSING' | 'PENDING' | 'READY' | 'FAILED' | 'DELETED';

type DocumentOperation = {
  quoteId: string;
  quoteVersionId: string;
  versionNumber: number;
  document: {
    id: string | null;
    status: DocumentStatus;
    templateVersion: string | null;
    contentType: 'application/pdf' | null;
    byteSize: number | null;
    readyAt: string | null;
  };
  acceptance: {
    id: string;
    signerName: string;
    termsVersion: string;
    acceptedAt: string;
    project: { id: string; folio: string } | null;
  } | null;
  actions: { canDownload: boolean; canGenerate: boolean };
};

type ProjectSummary = { id: string; folio: string };

type DownloadResponse = {
  downloadUrl: string;
  expiresAt: string;
};

type ErrorResponse = { error?: { message?: string } };

type Props = Readonly<{
  versionId: string;
  versionNumber: number;
  canRead: boolean;
  canGenerate: boolean;
  canReadProject: boolean;
  canCreateProject: boolean;
}>;

const STATUS_LABELS: Record<DocumentStatus, string> = {
  MISSING: 'Aún no generado',
  PENDING: 'Preparando PDF',
  READY: 'Listo para compartir',
  FAILED: 'Requiere reintento',
  DELETED: 'Retirado',
};

const STATUS_NOTES: Record<DocumentStatus, string> = {
  MISSING: 'Genera el documento cuando la versión esté lista para el cliente.',
  PENDING: 'La preparación está en curso. Actualiza el expediente en unos segundos.',
  READY: 'El documento está almacenado de forma privada y puede descargarse con una URL temporal.',
  FAILED: 'La preparación anterior no terminó. Puedes iniciar un reintento seguro.',
  DELETED: 'El documento fue retirado y no se puede regenerar desde este flujo.',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return 'Tamaño no disponible';
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(data.error?.message ?? 'No fue posible completar la operación.');
  return data as T;
}

export default function StaffQuoteDocumentPanel({ versionId, versionNumber, canRead, canGenerate, canReadProject, canCreateProject }: Props) {
  const [operation, setOperation] = useState<DocumentOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'download' | 'generate' | 'convert' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);

  const loadOperation = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${versionId}/document`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<DocumentOperation>(response);
      setOperation(data);
      setProject(data.acceptance?.project ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible consultar el documento.');
      setOperation(null);
    } finally {
      setLoading(false);
    }
  }, [canRead, versionId]);

  useEffect(() => { void loadOperation(); }, [loadOperation]);

  const download = async () => {
    setBusy('download');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${versionId}/pdf`, { credentials: 'include', cache: 'no-store' });
      const result = await readResponse<DownloadResponse>(response);
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      setNotice('PDF listo para descarga en una nueva pestaña.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible preparar la descarga.');
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    setBusy('generate');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${versionId}/pdf`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      await readResponse(response);
      await loadOperation();
      setNotice('PDF comercial generado y verificado.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible generar el PDF.');
    } finally {
      setBusy(null);
    }
  };

  // J1-02: idempotente en el servidor -- reintentar tras un error de red nunca crea un segundo
  // proyecto para la misma aceptación, así que no hace falta protección adicional aquí más allá
  // de deshabilitar el botón mientras la petición está en curso.
  const convertToProject = async () => {
    if (!operation?.acceptance) return;
    setBusy('convert');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/staff/projects', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteAcceptanceId: operation.acceptance.id }) });
      const created = await readResponse<ProjectSummary>(response);
      setProject(created);
      setNotice(`Proyecto ${created.folio} creado.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible convertir la cotización en proyecto.');
    } finally {
      setBusy(null);
    }
  };

  if (!canRead) return null;

  const status = operation?.document.status ?? 'MISSING';
  const canDownload = Boolean(operation?.actions.canDownload);
  const canGenerateNow = Boolean(canGenerate && operation?.actions.canGenerate);

  return <section className="quote-document-panel" aria-label="Documento comercial y aceptación">
    <div className="quote-document-panel__head">
      <div>
        <p className="staff-section-label">Entrega documental</p>
        <h3>PDF y aceptación · V{versionNumber}</h3>
      </div>
      <span className={`quote-document-status quote-document-status--${status.toLowerCase()}`} aria-label={`Estado del PDF: ${STATUS_LABELS[status]}`}>
        <span aria-hidden="true" /> {STATUS_LABELS[status]}
      </span>
    </div>

    {loading && <div className="quote-document-panel__loading" role="status">Consultando estado documental…</div>}
    {!loading && <>
      <div className="quote-document-panel__body">
        <div className="quote-document-panel__summary">
          <strong>{STATUS_LABELS[status]}</strong>
          <span>{operation ? STATUS_NOTES[status] : 'No fue posible cargar el estado del documento.'}</span>
          {operation?.document.status === 'READY' && operation.document.readyAt && <small>{formatBytes(operation.document.byteSize)} · Verificado {formatDate(operation.document.readyAt)}</small>}
        </div>
        <div className="quote-document-panel__actions">
          {canDownload && <button className="staff-button staff-button--dark" type="button" onClick={() => void download()} disabled={busy !== null}>{busy === 'download' ? 'Preparando…' : 'Descargar PDF'}</button>}
          {canGenerateNow && <button className="staff-button staff-button--copper" type="button" onClick={() => void generate()} disabled={busy !== null}>{busy === 'generate' ? 'Generando…' : status === 'FAILED' ? 'Reintentar PDF' : 'Generar PDF'}</button>}
          {!canDownload && !canGenerateNow && status === 'PENDING' && <span className="quote-document-panel__muted">Preparación en curso</span>}
          {!canDownload && !canGenerateNow && status === 'DELETED' && <span className="quote-document-panel__muted">Documento retirado</span>}
        </div>
      </div>

      {operation?.acceptance ? <div className="quote-acceptance-evidence" aria-label="Evidencia de aceptación">
        <div><span className="quote-acceptance-evidence__mark" aria-hidden="true">✓</span><div><p className="staff-section-label">Evidencia registrada</p><strong>Cotización aceptada</strong></div></div>
        <dl><div><dt>Firmante</dt><dd>{operation.acceptance.signerName}</dd></div><div><dt>Términos</dt><dd>{operation.acceptance.termsVersion}</dd></div><div><dt>Fecha</dt><dd>{formatDate(operation.acceptance.acceptedAt)}</dd></div></dl>
        {project && canReadProject && <Link className="staff-button staff-button--outline" href={`/staff/projects/${project.id}`}>Ver proyecto {project.folio}</Link>}
        {!project && canCreateProject && <button className="staff-button staff-button--copper" type="button" onClick={() => void convertToProject()} disabled={busy !== null}>{busy === 'convert' ? 'Convirtiendo…' : 'Convertir a proyecto'}</button>}
      </div> : <div className="quote-document-panel__empty"><span>Sin aceptación registrada</span><small>La evidencia aparecerá aquí cuando el cliente acepte esta versión.</small></div>}
    </>}

    {notice && <p className="staff-notice quote-document-panel__feedback" role="status">{notice}</p>}
    {error && <p className="staff-error quote-document-panel__feedback" role="alert">{error}</p>}
  </section>;
}
