'use client';

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PrivateBlockingState, PrivateButton, PrivateDialog, PrivateSelect, PrivateTextArea } from '@/components/private/ui';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { getOrCreateIdempotencyKey } from '@/lib/idempotency-key';
import { requestWorkspaceStatusActionLabel, type RequestWorkspacePrimaryAction } from '@/lib/request-workspace-primary-action';
import { QUOTE_REQUEST_INFORMATION_FIELDS, type QuoteRequestStatus } from '@/server/modules/quote-requests/domain';

export type RequestWorkspaceActionsV2Props = {
  requestId: string;
  status: QuoteRequestStatus;
  contact: { displayName: string; email: string; phone: string | null; user: { status: string } | null };
  suggestedMissingFields: string[];
  currentAssignee: { id: string; displayName: string; email: string } | null;
  availableActions: string[];
  availableStatusTransitions: QuoteRequestStatus[];
  capabilities: {
    requestsAssign: boolean;
    requestsReassign: boolean;
    requestsStatusUpdate: boolean;
    messagingSend: boolean;
    identityUsersManage: boolean;
  };
  onUpdated: () => Promise<void>;
  onQuoteReady: () => void;
  primaryActionKey?: string;
  compact?: boolean;
};

export type RequestWorkspaceActionsHandle = {
  activate: (action: RequestWorkspaceActionCommand) => void;
};

export type RequestWorkspaceActionCommand = RequestWorkspacePrimaryAction | {
  key: 'request.reassign';
  kind: 'reassign';
  label: 'Reasignar solicitud';
  description: string;
};

type Assignee = { id: string; displayName: string; email: string };
type ErrorResponse = { error?: { message?: string; requestId?: string } };
type RequestInformationField = (typeof QUOTE_REQUEST_INFORMATION_FIELDS)[number];
const DEFAULT_INFORMATION_MESSAGE = 'Para continuar con tu propuesta necesitamos confirmar los datos señalados. Respóndenos por este medio para seguir avanzando.';

const INFORMATION_FIELD_LABELS: Record<RequestInformationField, string> = {
  'contact.email': 'Correo de contacto',
  'contact.phone': 'Teléfono de contacto',
  'detail.projectType': 'Tipo de proyecto',
  'detail.location': 'Ubicación del proyecto',
  'detail.dimensions': 'Dimensiones del proyecto',
  'detail.projectStage': 'Etapa del proyecto',
  'detail.timeline': 'Horizonte del proyecto',
  'detail.budgetRange': 'Presupuesto del proyecto',
  'detail.description': 'Descripción del proyecto',
};

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(getApiErrorMessage(data, 'No fue posible completar la operación.'));
  return data as T;
}

const RequestWorkspaceActionsV2 = forwardRef<RequestWorkspaceActionsHandle, RequestWorkspaceActionsV2Props>(function RequestWorkspaceActionsV2({ requestId, status, contact, suggestedMissingFields, currentAssignee, availableActions, availableStatusTransitions, capabilities, onUpdated, onQuoteReady, primaryActionKey, compact = false }, ref) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [informationOpen, setInformationOpen] = useState(false);
  const [informationMessage, setInformationMessage] = useState(DEFAULT_INFORMATION_MESSAGE);
  const [missingFields, setMissingFields] = useState<RequestInformationField[]>([]);
  const [enablePortalAccess, setEnablePortalAccess] = useState(false);
  const [expanded, setExpanded] = useState(!compact);
  const [informationIdempotencyKey, setInformationIdempotencyKey] = useState(() => getOrCreateIdempotencyKey(null, 'request-information'));
  const informationTriggerRef = useRef<HTMLButtonElement>(null);
  const informationTitleId = useId();
  const informationDescriptionId = useId();
  const informationDrawerId = useId();

  useEffect(() => {
    setExpanded(!compact);
    if (compact) setInformationOpen(false);
  }, [compact]);

  const canTake = capabilities.requestsAssign && availableActions.includes('request.take');
  const canReassign = capabilities.requestsReassign && availableActions.includes('request.reassign');
  const canChangeStatus = capabilities.requestsStatusUpdate && availableStatusTransitions.length > 0;
  const canRequestInformation = capabilities.requestsStatusUpdate && capabilities.messagingSend && availableActions.includes('request.information');
  const reassignmentOptions = useMemo(() => assignees.filter((assignee) => assignee.id !== currentAssignee?.id).map((assignee) => ({ value: assignee.id, label: assignee.displayName })), [assignees, currentAssignee?.id]);
  const informationFieldOptions = useMemo(() => suggestedMissingFields.filter((field): field is RequestInformationField => (QUOTE_REQUEST_INFORMATION_FIELDS as readonly string[]).includes(field)).map((field) => ({ value: field, label: INFORMATION_FIELD_LABELS[field] })), [suggestedMissingFields]);

  useEffect(() => {
    if (!canReassign) return;
    const controller = new AbortController();
    fetch('/api/staff/quote-requests/assignees', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then((response) => readResponse<{ items: Assignee[] }>(response))
      .then((data) => setAssignees(data.items))
      .catch(() => {
        if (!controller.signal.aborted) setError('No fue posible cargar responsables disponibles.');
      });
    return () => controller.abort();
  }, [canReassign]);

  const run = useCallback(async (action: string, path: string, body: unknown, successMessage: string, after?: () => void | Promise<void>): Promise<boolean> => {
    setBusyAction(action);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      await readResponse(response);
      setNotice(successMessage);
      await onUpdated();
      await after?.();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible completar la operación.');
      if (action === 'take' || action === 'reassign') await onUpdated().catch(() => undefined);
      return false;
    } finally {
      setBusyAction(null);
    }
  }, [onUpdated]);

  const take = useCallback(() => run('take', `/api/staff/quote-requests/${encodeURIComponent(requestId)}/take`, {}, 'Solicitud tomada.'), [requestId, run]);
  const reassign = useCallback(async () => {
    if (!selectedAssigneeId || !assignmentReason.trim()) {
      setError('Selecciona un responsable e indica el motivo de la reasignación.');
      setNotice(null);
      return;
    }
    // UX audit fix: sin esto, el motivo y el responsable elegido se quedaban visibles en el
    // formulario después de una reasignación exitosa -- una segunda reasignación poco después
    // podía enviarse sin querer con el motivo de la anterior, ya obsoleto, adjunto al historial
    // de una acción distinta. Sólo se limpia si la petición realmente tuvo éxito, para no borrar
    // lo que el staff tecleó si falló y quiere reintentar.
    const succeeded = await run('reassign', `/api/staff/quote-requests/${encodeURIComponent(requestId)}/assign`, { assignedToId: selectedAssigneeId, reason: assignmentReason.trim() }, 'Solicitud reasignada.');
    if (succeeded) { setSelectedAssigneeId(''); setAssignmentReason(''); }
  }, [assignmentReason, requestId, run, selectedAssigneeId]);
  const transition = useCallback(async (toStatus: QuoteRequestStatus) => {
    const succeeded = await run(`status:${toStatus}`, `/api/staff/quote-requests/${encodeURIComponent(requestId)}/status`, { toStatus, reason: statusReason.trim() || undefined }, 'Estado actualizado.', toStatus === 'EN_ELABORACION' ? onQuoteReady : undefined);
    if (succeeded) setStatusReason('');
  }, [onQuoteReady, requestId, run, statusReason]);

  const openInformation = useCallback(() => {
    setInformationOpen(true);
    setInformationMessage(DEFAULT_INFORMATION_MESSAGE);
    setMissingFields(informationFieldOptions.map(({ value }) => value));
    setEnablePortalAccess(false);
    setInformationIdempotencyKey(getOrCreateIdempotencyKey(null, 'request-information'));
    setNotice(null);
    setError(null);
  }, [informationFieldOptions]);

  const requestInformation = async () => {
    if (!informationMessage.trim()) {
      setError('Escribe el mensaje que recibirá el cliente.');
      setNotice(null);
      return;
    }
    setBusyAction('information');
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${encodeURIComponent(requestId)}/request-information`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: informationMessage, idempotencyKey: informationIdempotencyKey, missingFields, enablePortalAccess }),
      });
      await readResponse(response);
      setInformationOpen(false);
      setNotice('Solicitud de información registrada. El aviso quedó en cola para entrega.');
      await onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible registrar la solicitud de información.');
    } finally {
      setBusyAction(null);
    }
  };

  useImperativeHandle(ref, () => ({
    activate(action) {
      setExpanded(true);
      if (action.kind === 'take') {
        void take();
        return;
      }
      if (action.kind === 'information') {
        openInformation();
        return;
      }
      if (action.kind === 'status' && availableStatusTransitions.includes(action.targetStatus)) {
        void transition(action.targetStatus);
        return;
      }
      if (action.kind === 'reassign') {
        window.requestAnimationFrame(() => document.getElementById('request-workspace-v2-assignee')?.focus());
        return;
      }
      if (action.kind === 'quote') onQuoteReady();
    },
  }), [availableStatusTransitions, onQuoteReady, openInformation, take, transition]);

  return <section id="request-workspace-v2-actions" className={`request-workspace-v2__actions${compact ? ' request-workspace-v2__actions--compact' : ''}`} aria-labelledby="request-workspace-v2-actions-title">
    <div className="request-workspace-v2__section-heading"><div><p className="private-kicker">Siguiente acción</p><h2 id="request-workspace-v2-actions-title">Revisión operativa</h2></div><div className="request-workspace-v2__actions-heading-side">{!compact && <p className="request-workspace-v2__muted">Cada cambio queda registrado en la actividad.</p>}{compact && <PrivateButton type="button" variant="quiet" aria-expanded={expanded} aria-controls="request-workspace-v2-actions-body" onClick={() => setExpanded((current) => !current)}>{expanded ? 'Ocultar acciones' : 'Ver acciones'}</PrivateButton>}</div></div>
    {notice && <p className="private-status private-status--success" role="status">{notice}</p>}
    {error && <PrivateBlockingState title="No fue posible completar la acción.">{error}</PrivateBlockingState>}
    {expanded && <div id="request-workspace-v2-actions-body" className="request-workspace-v2__action-grid">
      <section className="request-workspace-v2__action-card" aria-labelledby="request-workspace-v2-owner-title">
        <p className="private-kicker">Responsable</p>
        <h3 id="request-workspace-v2-owner-title">{currentAssignee ? currentAssignee.displayName : 'Sin responsable'}</h3>
        {currentAssignee ? <p>{currentAssignee.email}</p> : <p>La solicitud está disponible para que la tome un operador.</p>}
        {canTake && primaryActionKey !== 'request.take' && <PrivateButton type="button" busy={busyAction === 'take'} onClick={() => void take()}>Tomar solicitud</PrivateButton>}
        {availableActions.includes('request.taken') && <p className="request-workspace-v2__action-confirmation" role="status">Esta solicitud está tomada por ti.</p>}
        {canReassign && <div className="request-workspace-v2__action-form"><PrivateSelect id="request-workspace-v2-assignee" label="Nuevo responsable" value={selectedAssigneeId} options={reassignmentOptions} onValueChange={setSelectedAssigneeId} placeholder="Selecciona un responsable" /><PrivateTextArea id="request-workspace-v2-reassign-reason" label="Motivo de reasignación" value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} required rows={3} /><PrivateButton type="button" variant="secondary" busy={busyAction === 'reassign'} onClick={() => void reassign()}>Reasignar solicitud</PrivateButton></div>}
      </section>
      <section className="request-workspace-v2__action-card" aria-labelledby="request-workspace-v2-review-title">
        <p className="private-kicker">Checklist de revisión</p>
        <h3 id="request-workspace-v2-review-title">Avanza el expediente</h3>
        {canRequestInformation && (primaryActionKey !== 'request.information' || informationOpen) && <div className="request-workspace-v2__information-request">{primaryActionKey !== 'request.information' && <PrivateButton ref={informationTriggerRef} type="button" variant="secondary" busy={busyAction === 'information'} aria-expanded={informationOpen} aria-controls={informationOpen ? informationDrawerId : undefined} onClick={openInformation}>Solicitar información</PrivateButton>}<PrivateDialog open={informationOpen} onClose={() => { if (busyAction !== 'information') setInformationOpen(false); }} modal={false} id={informationDrawerId} className="request-workspace-v2__information-drawer" labelledBy={informationTitleId} describedBy={informationDescriptionId}><p className="private-kicker">Una sola intención</p><h4 id={informationTitleId}>Qué necesitamos del cliente</h4><p id={informationDescriptionId} className="request-workspace-v2__muted">El expediente cambiará a Información requerida cuando el mensaje y el evento queden registrados.</p><fieldset className="request-workspace-v2__information-fields"><legend>Campos por confirmar</legend>{informationFieldOptions.length > 0 ? informationFieldOptions.map(({ value, label }) => <label key={value}><input type="checkbox" checked={missingFields.includes(value)} onChange={(event) => setMissingFields((current) => event.target.checked ? [...new Set([...current, value])] : current.filter((field) => field !== value))} />{label}</label>) : <p className="request-workspace-v2__muted">No hay campos incompletos detectados; el mensaje puede pedir una confirmación abierta.</p>}</fieldset><PrivateTextArea id="request-workspace-v2-information-message" label="Mensaje para el cliente" value={informationMessage} onChange={(event) => setInformationMessage(event.target.value)} required rows={5} /><div className="request-workspace-v2__information-recipient"><p className="private-kicker">Canal y destinatario</p><strong>Portal del cliente + aviso por correo</strong><span>{contact.displayName} · {contact.email}</span>{contact.phone && <span>{contact.phone}</span>}<small>El contenido compartido queda visible en el expediente del cliente.</small></div>{capabilities.identityUsersManage && contact.user?.status !== 'ACTIVE' && <label className="request-workspace-v2__information-access"><input type="checkbox" checked={enablePortalAccess} onChange={(event) => setEnablePortalAccess(event.target.checked)} />Habilitar o reutilizar su acceso al portal y enviarle un enlace seguro.</label>}<div className="request-workspace-v2__information-actions"><PrivateButton type="button" variant="quiet" onClick={() => setInformationOpen(false)} disabled={busyAction === 'information'}>Cancelar</PrivateButton><PrivateButton type="button" busy={busyAction === 'information'} onClick={() => void requestInformation()}>Enviar y esperar información</PrivateButton></div></PrivateDialog></div>}
        {canChangeStatus ? <><PrivateTextArea id="request-workspace-v2-status-reason" label="Nota de la acción" value={statusReason} onChange={(event) => setStatusReason(event.target.value)} description="Opcional para revisión; úsala para dejar contexto operativo." rows={3} /><div className="request-workspace-v2__status-actions">{availableStatusTransitions.filter((nextStatus) => primaryActionKey !== `request.status:${nextStatus}`).map((nextStatus) => <PrivateButton key={nextStatus} type="button" variant={nextStatus === 'RECHAZADA' ? 'danger' : nextStatus === 'EN_ELABORACION' ? 'primary' : 'secondary'} busy={busyAction === `status:${nextStatus}`} onClick={() => void transition(nextStatus)}>{requestWorkspaceStatusActionLabel(nextStatus)}</PrivateButton>)}</div></> : <p className="request-workspace-v2__muted">No hay pasos disponibles para este estado o tu cuenta sólo tiene acceso de lectura.</p>}
        <span className="request-workspace-v2__status-context" aria-hidden="true">{status}</span>
      </section>
    </div>}
  </section>;
});

export default RequestWorkspaceActionsV2;
