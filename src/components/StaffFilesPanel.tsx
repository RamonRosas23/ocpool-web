'use client';

import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useId, useState } from 'react';
import { nextRovingTabIndex, PrivateSelect } from '@/components/private/ui';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { getOrCreateIdempotencyKey } from '@/lib/idempotency-key';
import { shouldResetUploadIdempotencyKey, type UploadStage } from '@/lib/private-file-upload';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const ACCEPTED_EXTENSIONS = /\.(pdf|jpe?g|png|webp)$/iu;

export type StaffFilesCapabilities = {
  filesRead: boolean;
  filesUpload: boolean;
  filesDownload: boolean;
  filesDelete: boolean;
  filesInternalRead: boolean;
  filesManage: boolean;
};

type FileVisibility = 'CUSTOMER' | 'INTERNAL';
type FileItem = {
  id: string;
  originalFileName: string;
  category: string;
  visibility: FileVisibility;
  status: 'PENDING_SCAN' | 'AVAILABLE' | 'REJECTED' | 'DELETED' | string;
  contentType: string;
  byteSize: string;
  createdAt: string;
  updatedAt: string;
  downloadAvailable: boolean;
};

type FilesResponse = { items: FileItem[]; nextCursor: string | null };
type ReserveResponse = { file: FileItem; uploadUrl: string | null };
type ErrorResponse = { error?: { message?: string; requestId?: string } };
type FileCategory = 'REFERENCE_IMAGE' | 'TECHNICAL_DOCUMENT' | 'CLIENT_DOCUMENT' | 'INTERNAL_DOCUMENT';
class ApiResponseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

function endpoint(requestId: string, suffix = ''): string {
  return `/api/staff/quote-requests/${requestId}/files${suffix}`;
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
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function statusLabel(file: FileItem): string {
  if (file.status === 'AVAILABLE' && file.downloadAvailable) return 'Disponible';
  if (file.status === 'PENDING_SCAN') return 'En validación';
  return 'No disponible';
}

function mergeFiles(current: FileItem[], incoming: FileItem[]): FileItem[] {
  const byId = new Map(current.map((file) => [file.id, file]));
  incoming.forEach((file) => byId.set(file.id, file));
  return [...byId.values()].sort((left, right) => {
    const dateDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return dateDiff || left.id.localeCompare(right.id);
  });
}

function categoryLabel(category: string): string {
  return { REFERENCE_IMAGE: 'Referencia', TECHNICAL_DOCUMENT: 'Técnico', CLIENT_DOCUMENT: 'Cliente', INTERNAL_DOCUMENT: 'Interno' }[category] ?? 'Documento';
}

function acceptedFile(file: File): boolean {
  return (ACCEPTED_TYPES.has(file.type) || file.type === '' && ACCEPTED_EXTENSIONS.test(file.name)) && ACCEPTED_EXTENSIONS.test(file.name);
}

const DEFAULT_CAPABILITIES: StaffFilesCapabilities = { filesRead: false, filesUpload: false, filesDownload: false, filesDelete: false, filesInternalRead: false, filesManage: false };

export default function StaffFilesPanel({ requestId, capabilities = DEFAULT_CAPABILITIES }: { requestId: string; capabilities?: StaffFilesCapabilities }) {
  const headingId = useId();
  const sharedTabId = useId();
  const internalTabId = useId();
  const visibilityFieldId = useId();
  const categoryFieldId = useId();
  const [items, setItems] = useState<FileItem[]>([]);
  const [mode, setMode] = useState<FileVisibility>('CUSTOMER');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadState, setUploadState] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadIdempotencyKey, setUploadIdempotencyKey] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [visibility, setVisibility] = useState<FileVisibility>('CUSTOMER');
  const [category, setCategory] = useState<FileCategory>('CLIENT_DOCUMENT');

  const loadFiles = useCallback(async (cursor?: string) => {
    if (!capabilities.filesRead) {
      setLoading(false);
      setItems([]);
      setNextCursor(null);
      return;
    }
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(endpoint(requestId, `?${params.toString()}`), { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<FilesResponse>(response);
      setItems((current) => cursor ? mergeFiles(current, data.items) : data.items);
      setNextCursor(data.nextCursor);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar los archivos.');
    } finally {
      if (cursor) setLoadingMore(false);
      else setLoading(false);
    }
  }, [capabilities.filesRead, requestId]);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    void loadFiles(nextCursor);
  };
  useEffect(() => {
    if (visibility === 'INTERNAL') setCategory((current) => current === 'CLIENT_DOCUMENT' || current === 'REFERENCE_IMAGE' ? 'INTERNAL_DOCUMENT' : current);
    else if (category === 'INTERNAL_DOCUMENT') setCategory('TECHNICAL_DOCUMENT');
  }, [category, visibility]);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!acceptedFile(file)) { setError('Elige un PDF, JPG, PNG o WebP válido.'); setSelectedFile(null); return; }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) { setError('El archivo debe pesar entre 1 byte y 25 MB.'); setSelectedFile(null); return; }
    setError(null);
    setSelectedFile(file);
    setUploadIdempotencyKey(getOrCreateIdempotencyKey(null, `staff-${requestId}`));
    setUploadProgress(null);
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

  const upload = async () => {
    if (!selectedFile || !capabilities.filesUpload || uploading) return;
    setUploading(true);
    setError(null);
    setUploadProgress(0);
    const idempotencyKey = getOrCreateIdempotencyKey(uploadIdempotencyKey, `staff-${requestId}`);
    setUploadIdempotencyKey(idempotencyKey);
    let uploadStage: UploadStage = 'reserve';
    try {
      setUploadState('Preparando carga…');
      const reserveResponse = await fetch(endpoint(requestId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ originalFileName: selectedFile.name, contentType: selectedFile.type || 'application/octet-stream', byteSize: selectedFile.size, category, visibility, idempotencyKey }),
      });
      const reservation = await readResponse<ReserveResponse>(reserveResponse);
      if (!reservation.uploadUrl) {
        setSelectedFile(null);
        setUploadIdempotencyKey(null);
        setUploadProgress(null);
        setShowUpload(false);
        await loadFiles();
        return;
      }
      uploadStage = 'storage';
      setUploadState('Subiendo archivo…');
      await uploadToStorage(reservation.uploadUrl, selectedFile, (progress) => setUploadProgress(progress));
      uploadStage = 'complete';
      setUploadState('Validando archivo…');
      const completeResponse = await fetch(endpoint(requestId, `/${reservation.file.id}/complete`), { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      await readResponse<{ file: FileItem }>(completeResponse);
      setSelectedFile(null);
      setUploadIdempotencyKey(null);
      setUploadProgress(null);
      setShowUpload(false);
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
    if (!capabilities.filesDownload) return;
    setBusyFileId(file.id);
    setError(null);
    try {
      const response = await fetch(endpoint(requestId, `/${file.id}/download`), { credentials: 'include', cache: 'no-store' });
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
    if (!capabilities.filesDelete && !capabilities.filesManage) return;
    setBusyFileId(file.id);
    setError(null);
    try {
      const response = await fetch(endpoint(requestId, `/${file.id}`), { method: 'DELETE', credentials: 'include' });
      await readResponse<{ fileId: string }>(response);
      setConfirmDeleteId(null);
      await loadFiles();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible eliminar el archivo.');
    } finally {
      setBusyFileId(null);
    }
  };

  const visibleItems = items.filter((file) => file.visibility === mode);
  const canDelete = capabilities.filesDelete || capabilities.filesManage;
  const availableCategories = visibility === 'INTERNAL' ? ['TECHNICAL_DOCUMENT', 'INTERNAL_DOCUMENT'] : ['REFERENCE_IMAGE', 'TECHNICAL_DOCUMENT', 'CLIENT_DOCUMENT'];
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tabButtons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const currentIndex = tabButtons.indexOf(event.currentTarget);
    const nextIndex = nextRovingTabIndex(event.key, currentIndex, tabButtons.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextMode = nextIndex === 0 ? 'CUSTOMER' : 'INTERNAL';
    setMode(nextMode);
    tabButtons[nextIndex]?.focus();
  };

  return <section className="staff-files" aria-labelledby={headingId}>
    <div className="staff-files__head"><div><p className="staff-section-label">Documentación</p><h3 id={headingId}>Archivos del expediente</h3><p className="staff-files__intro">Consulta y organiza el material relacionado sin salir del expediente.</p></div>{capabilities.filesUpload && <button type="button" className="staff-button staff-button--copper" onClick={() => setShowUpload((current) => !current)}>{showUpload ? 'Cerrar carga' : 'Añadir archivo'}</button>}</div>
    {showUpload && capabilities.filesUpload && <div className="staff-files__upload"><label><span>Archivo</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={selectFile} disabled={uploading} /></label><PrivateSelect id={visibilityFieldId} label="Visibilidad" required value={visibility} onValueChange={(value) => setVisibility(value as FileVisibility)} options={[{ value: 'CUSTOMER', label: 'Compartido con cliente' }, { value: 'INTERNAL', label: 'Sólo equipo' }]} disabled={uploading} /><PrivateSelect id={categoryFieldId} label="Categoría" required value={category} onValueChange={(value) => setCategory(value as FileCategory)} options={availableCategories.map((option) => ({ value: option, label: categoryLabel(option) }))} disabled={uploading} /><div className="staff-files__upload-foot"><span>{selectedFile ? selectedFile.name : 'Ningún archivo seleccionado'}</span><button type="button" className="staff-button staff-button--dark" disabled={!selectedFile || uploading} onClick={() => void upload()}>{uploading ? 'Cargando…' : error && selectedFile ? 'Reintentar carga' : 'Cargar archivo'}</button></div></div>}
    {uploadState && <p className="staff-files__progress" role="status" aria-live="polite">{uploadState}{uploadProgress !== null && uploadState.startsWith('Subiendo') ? ` ${uploadProgress}%` : ''}</p>}
    {error && <div className="staff-files__error" role="alert"><p>{error}</p><button type="button" onClick={() => void loadFiles()}>Reintentar</button></div>}
    {!capabilities.filesRead && <div className="staff-files__empty"><strong>Archivos no disponibles.</strong><span>Tu rol no tiene permiso para consultar los archivos de este expediente.</span></div>}
    {capabilities.filesRead && <><div className="staff-files__tabs" role="tablist" aria-label="Visibilidad de archivos" aria-orientation="horizontal"><button id={sharedTabId} type="button" role="tab" tabIndex={mode === 'CUSTOMER' ? 0 : -1} aria-selected={mode === 'CUSTOMER'} aria-controls={mode === 'CUSTOMER' ? `${headingId}-shared` : undefined} className={mode === 'CUSTOMER' ? 'is-active' : ''} onKeyDown={handleTabKeyDown} onClick={() => setMode('CUSTOMER')}>{`Compartidos ${items.filter((file) => file.visibility === 'CUSTOMER').length}`}</button>{capabilities.filesInternalRead && <button id={internalTabId} type="button" role="tab" tabIndex={mode === 'INTERNAL' ? 0 : -1} aria-selected={mode === 'INTERNAL'} aria-controls={mode === 'INTERNAL' ? `${headingId}-internal` : undefined} className={mode === 'INTERNAL' ? 'is-active' : ''} onKeyDown={handleTabKeyDown} onClick={() => setMode('INTERNAL')}>{`Internos ${items.filter((file) => file.visibility === 'INTERNAL').length}`}</button>}</div><div id={mode === 'CUSTOMER' ? `${headingId}-shared` : `${headingId}-internal`} role="tabpanel" aria-labelledby={mode === 'CUSTOMER' ? sharedTabId : internalTabId}>{loading && <div className="staff-files__loading" role="status" aria-label="Cargando archivos"><i /><i /><i /></div>}{!loading && visibleItems.length === 0 && <div className="staff-files__empty"><strong>{mode === 'CUSTOMER' ? 'Aún no hay archivos compartidos.' : 'Aún no hay archivos internos.'}</strong><span>Los archivos de esta visibilidad aparecerán aquí cuando se agreguen al expediente.</span></div>}{!loading && visibleItems.length > 0 && <ul className={`staff-files__list${mode === 'INTERNAL' ? ' is-internal' : ''}`}>{visibleItems.map((file) => <li className="staff-file" key={file.id}><div className="staff-file__icon" aria-hidden="true">{file.contentType === 'application/pdf' ? 'PDF' : 'IMG'}</div><div className="staff-file__info"><strong title={file.originalFileName}>{file.originalFileName}</strong><span>{categoryLabel(file.category)} · {formatBytes(file.byteSize)} · {formatDate(file.createdAt)}</span></div><span className={`staff-file__status staff-file__status--${file.status.toLowerCase()}`}>{statusLabel(file)}</span><div className="staff-file__actions">{file.downloadAvailable && capabilities.filesDownload && <button type="button" className="staff-file__action" disabled={busyFileId === file.id} onClick={() => void download(file)}>Descargar {file.originalFileName}</button>}{canDelete && <>{confirmDeleteId === file.id ? <><button type="button" className="staff-file__action staff-file__action--danger" disabled={busyFileId === file.id} onClick={() => void remove(file)}>Confirmar eliminación</button><button type="button" className="staff-file__cancel" disabled={busyFileId === file.id} onClick={() => setConfirmDeleteId(null)}>Cancelar</button></> : <button type="button" className="staff-file__cancel" disabled={busyFileId === file.id} onClick={() => setConfirmDeleteId(file.id)}>Eliminar archivo</button>}</>}</div></li>)}</ul>}</div></>}
    {capabilities.filesRead && nextCursor && <button type="button" className="staff-files__more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Cargando archivos…' : 'Ver más archivos'}</button>}
    <p className="staff-files__note">Formatos permitidos: PDF, JPG, PNG y WebP · máximo 25 MB.</p>
  </section>;
}
