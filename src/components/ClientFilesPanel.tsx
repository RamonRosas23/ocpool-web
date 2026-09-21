'use client';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { getOrCreateIdempotencyKey } from '@/lib/idempotency-key';
import { fileStatusIcon, fileStatusLabel } from '@/lib/labels';
import { shouldResetUploadIdempotencyKey, type UploadStage } from '@/lib/private-file-upload';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const ACCEPTED_EXTENSIONS = /\.(pdf|jpe?g|png|webp)$/iu;

type FileItem = {
  id: string;
  originalFileName: string;
  category: string;
  status: 'PENDING_SCAN' | 'AVAILABLE' | 'REJECTED' | 'DELETED' | string;
  contentType: string;
  byteSize: string;
  scanStatus: string;
  createdAt: string;
  updatedAt: string;
  downloadAvailable: boolean;
};

type FilesResponse = { items: FileItem[]; nextCursor: string | null };
type ReserveResponse = { file: FileItem; uploadUrl: string | null };
type ErrorResponse = { error?: { message?: string; requestId?: string } };
class ApiResponseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

function fileEndpoint(requestId: string, suffix = ''): string {
  return `/api/portal/requests/${requestId}/files${suffix}`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new ApiResponseError(getApiErrorMessage(data, 'No fue posible completar la operación.'), response.status);
  return data as T;
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Tamaño no disponible';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function mergeFiles(current: FileItem[], incoming: FileItem[]): FileItem[] {
  const byId = new Map(current.map((file) => [file.id, file]));
  incoming.forEach((file) => byId.set(file.id, file));
  return [...byId.values()].sort((left, right) => {
    const dateDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return dateDiff || left.id.localeCompare(right.id);
  });
}

function fileIsAccepted(file: File): boolean {
  return (ACCEPTED_TYPES.has(file.type) || file.type === '' && ACCEPTED_EXTENSIONS.test(file.name)) && ACCEPTED_EXTENSIONS.test(file.name);
}

function FileStatusBadge({ file }: { file: FileItem }) {
  const StatusIcon = fileStatusIcon(file);
  return <span className={`client-file__status client-file__status--${file.status.toLowerCase()}`}><StatusIcon size={13} aria-hidden="true" />{fileStatusLabel(file)}</span>;
}

export default function ClientFilesPanel({ requestId }: { requestId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<FileItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadState, setUploadState] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadIdempotencyKey, setUploadIdempotencyKey] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(fileEndpoint(requestId, `?${params.toString()}`), { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<FilesResponse>(response);
      setItems((current) => cursor ? mergeFiles(current, data.items) : data.items);
      setNextCursor(data.nextCursor);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar los archivos del expediente.');
    } finally {
      if (cursor) setLoadingMore(false);
      else setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    void loadFiles(nextCursor);
  };

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!fileIsAccepted(file)) {
      setError('Elige un PDF, JPG, PNG o WebP válido.');
      setSelectedFile(null);
      setUploadIdempotencyKey(null);
      setUploadProgress(null);
      return;
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      setError('El archivo debe pesar entre 1 byte y 25 MB.');
      setSelectedFile(null);
      setUploadIdempotencyKey(null);
      setUploadProgress(null);
      return;
    }
    setSelectedFile(file);
    setUploadIdempotencyKey(getOrCreateIdempotencyKey(null, `portal-${requestId}`));
    setUploadProgress(null);
    void upload(file);
  };

  const uploadToStorage = (uploadUrl: string, file: File, onProgress: (progress: number) => void): Promise<void> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('No fue posible subir el archivo. Inténtalo de nuevo.'));
    xhr.onerror = () => reject(new Error('No fue posible subir el archivo. Inténtalo de nuevo.'));
    xhr.onabort = () => reject(new Error('La carga del archivo fue cancelada.'));
    xhr.send(file);
  });

  const upload = async (file: File = selectedFile as File) => {
    if (!file || uploading) return;

    setUploading(true);
    setError(null);
    setUploadProgress(0);
    const idempotencyKey = getOrCreateIdempotencyKey(uploadIdempotencyKey, `portal-${requestId}`);
    setUploadIdempotencyKey(idempotencyKey);
    let uploadStage: UploadStage = 'reserve';
    try {
      setUploadState('Preparando carga…');
      const reserveResponse = await fetch(fileEndpoint(requestId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          originalFileName: file.name,
          contentType: file.type || 'application/octet-stream',
          byteSize: file.size,
          category: 'CLIENT_DOCUMENT',
          visibility: 'CUSTOMER',
          idempotencyKey,
        }),
      });
      const reservation = await readResponse<ReserveResponse>(reserveResponse);
      if (!reservation.uploadUrl) {
        setSelectedFile(null);
        setUploadIdempotencyKey(null);
        setUploadProgress(null);
        await loadFiles();
        return;
      }

      uploadStage = 'storage';
      setUploadState('Subiendo archivo…');
      await uploadToStorage(reservation.uploadUrl, file, (progress) => setUploadProgress(progress));

      uploadStage = 'complete';
      setUploadState('Validando archivo…');
      const completeResponse = await fetch(fileEndpoint(requestId, `/${reservation.file.id}/complete`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      await readResponse<{ file: FileItem }>(completeResponse);
      setSelectedFile(null);
      setUploadIdempotencyKey(null);
      setUploadProgress(null);
      await loadFiles();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No fue posible cargar el archivo.';
      if (caught instanceof ApiResponseError && shouldResetUploadIdempotencyKey(uploadStage, caught.status)) setUploadIdempotencyKey(null);
      await loadFiles();
      setError(message);
    } finally {
      setUploading(false);
      setUploadState('');
    }
  };

  const download = async (file: FileItem) => {
    setBusyFileId(file.id);
    setError(null);
    try {
      const response = await fetch(fileEndpoint(requestId, `/${file.id}/download`), { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<{ downloadUrl: string }>(response);
      const anchor = document.createElement('a');
      anchor.href = data.downloadUrl;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      anchor.download = file.originalFileName;
      anchor.click();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible preparar la descarga.');
    } finally {
      setBusyFileId(null);
    }
  };

  const remove = async (file: FileItem) => {
    setBusyFileId(file.id);
    setError(null);
    try {
      const response = await fetch(fileEndpoint(requestId, `/${file.id}`), { method: 'DELETE', credentials: 'include' });
      await readResponse<{ fileId: string }>(response);
      setConfirmDeleteId(null);
      await loadFiles();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible eliminar el archivo.');
    } finally {
      setBusyFileId(null);
    }
  };

  return <section className="client-files" aria-labelledby="client-files-title">
    <div className="client-files__head">
      <div>
        <p className="client-eyebrow">Material de referencia</p>
        <h3 id="client-files-title">Archivos del expediente</h3>
        <p className="client-files__intro">Comparte planos, referencias o documentos relacionados con tu proyecto.</p>
      </div>
      <label className={`client-files__add${uploading ? ' is-disabled' : ''}`}>
        <span>{uploading ? 'Cargando…' : 'Añadir archivo'}</span>
        <input ref={inputRef} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" aria-label="Añadir archivo" disabled={uploading} onChange={selectFile} />
      </label>
    </div>
    {uploadState && <p className="client-files__progress" role="status" aria-live="polite">{uploadState}{uploadProgress !== null && uploadState.startsWith('Subiendo') ? ` ${uploadProgress}%` : ''}</p>}
    {error && <div className="client-files__error" role="alert"><p>{error}</p><div className="client-files__error-actions">{selectedFile && !uploading && <button type="button" onClick={() => void upload()}>Reintentar carga</button>}<button type="button" onClick={() => void loadFiles()}>Actualizar lista</button></div></div>}
    {loading && <div className="client-files__loading" role="status" aria-label="Cargando archivos"><i /><i /></div>}
    {!loading && !items.length && <p className="client-files__empty">Aún no hay archivos.</p>}
    {!loading && items.length > 0 && <ul className="client-files__list">
      {items.map((file) => <li className="client-file" key={file.id}>
        <div className="client-file__icon" aria-hidden="true">{file.contentType === 'application/pdf' ? 'PDF' : 'IMG'}</div>
        <div className="client-file__info"><strong title={file.originalFileName}>{file.originalFileName}</strong><span>{formatBytes(file.byteSize)} · {formatDate(file.createdAt)}</span></div>
        <FileStatusBadge file={file} />
        <div className="client-file__actions">
          {file.downloadAvailable && <button type="button" className="client-file__action" disabled={busyFileId === file.id} onClick={() => void download(file)}>Descargar {file.originalFileName}</button>}
          {confirmDeleteId === file.id ? <span className="client-file__confirm"><small className="client-file__confirm-warning">No se puede deshacer.</small><button type="button" className="client-file__action client-file__action--danger" disabled={busyFileId === file.id} onClick={() => void remove(file)}>Confirmar eliminación</button><button type="button" className="client-file__cancel" disabled={busyFileId === file.id} onClick={() => setConfirmDeleteId(null)}>Cancelar</button></span> : <button type="button" className="client-file__cancel" disabled={busyFileId === file.id} onClick={() => setConfirmDeleteId(file.id)}>Eliminar archivo</button>}
        </div>
      </li>)}
    </ul>}
    {nextCursor && <button type="button" className="client-files__more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Cargando archivos…' : 'Ver más archivos'}</button>}
    <p className="client-files__note">Formatos permitidos: PDF, JPG, PNG y WebP · máximo 25 MB.</p>
  </section>;
}
