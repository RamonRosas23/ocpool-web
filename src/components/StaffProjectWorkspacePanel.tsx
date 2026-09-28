'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, CircleCheck, Compass, Hourglass, X } from 'lucide-react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffHeader from '@/components/StaffHeader';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { useStaffSession } from '@/components/staff/StaffSessionContext';
import ExpedienteJourney from '@/components/staff/ExpedienteJourney';
import { PrivateBlockingState, PrivateDialog, PrivateLinkButton, PrivateSelect, usePrivateToast } from '@/components/private/ui';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { formatDateTime } from '@/lib/format-date';
import { moneyLabel } from '@/lib/money';
import { projectNextStep, type ProjectNextStepAction } from '@/lib/project-stage';

type ProjectStatus = 'EN_TRANSICION' | 'COMPLETADO';

const SUGGESTED_HANDOFF_TASKS = [
  'Confirmar anticipo y forma de pago',
  'Agendar visita de arranque con el cliente',
  'Validar medidas y condiciones del sitio',
  'Programar equipo, materiales y cuadrilla',
  'Presentar al responsable de obra con el cliente',
];

type ChecklistItem = {
  id: string;
  label: string;
  position: number;
  completedAt: string | null;
  completedBy: { displayName: string } | null;
};

type ProjectLine = { id: string; name: string; description: string | null; unit: string; quantityMilliunits: string; totalMinor: string; sectionId: string | null };
type ProjectSection = { id: string; title: string; description: string | null };

type ProjectWorkspace = {
  id: string;
  folio: string;
  status: ProjectStatus;
  createdAt: string;
  completedAt: string | null;
  owner: { id: string; displayName: string } | null;
  createdBy: { id: string; displayName: string; type?: string };
  client: { id: string; displayName: string };
  contact: { id: string; displayName: string; email: string; phone: string | null };
  quoteRequest: { id: string; folio: string; projectType: string; location: string; description: string };
  acceptedVersion: {
    versionNumber: number;
    currencyCode: string;
    totalMinor: string;
    acceptedAt: string;
    signerName: string;
    sections: ProjectSection[];
    lines: ProjectLine[];
  };
  checklistItems: ChecklistItem[];
  activity: { id: string; action: string; createdAt: string }[];
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  EN_TRANSICION: 'En transición',
  COMPLETADO: 'Handoff completado',
};

const ACTIVITY_LABELS: Record<string, string> = {
  'project.created': 'Proyecto creado a partir de la cotización aceptada.',
  'project.completed': 'Handoff marcado como completado.',
  'project.reopened': 'Handoff reabierto para seguir en transición.',
  'project.owner_changed': 'Responsable actualizado.',
  'project.checklist_items_added': 'Se agregaron tareas al checklist.',
  'project.checklist_item_completed': 'Se marcó una tarea del checklist como completada.',
  'project.checklist_item_reopened': 'Se reabrió una tarea del checklist.',
};

const NEXT_STEP_CTA: Partial<Record<ProjectNextStepAction, string>> = {
  owner: 'Elegir responsable',
  checklist: 'Escribir tareas',
  tasks: 'Ver pendientes',
};

function quantityLabel(milliunits: string): string {
  if (!/^\d+$/.test(milliunits)) return '—';
  return (Number(milliunits) / 1000).toLocaleString('es-MX', { maximumFractionDigits: 3 });
}

export default function StaffProjectWorkspacePanel({ projectId }: { projectId: string }) {
  const session = useStaffSession();
  const { showToast } = usePrivateToast();
  // Sin sesión en contexto (header degradado) se asume que puede gestionar: el servidor sigue
  // siendo quien autoriza cada comando; esto sólo evita ofrecer controles a perfiles de lectura.
  const canManage = session?.capabilities.projectsManage !== false;
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [assignees, setAssignees] = useState<Array<{ id: string; displayName: string }>>([]);
  const [assigneesError, setAssigneesError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setAssigneesError(null);
    fetch('/api/staff/projects/assignees', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then((response) => readApiResponse<{ items: Array<{ id: string; displayName: string }> }>(response, 'No fue posible cargar responsables.'))
      .then((result) => {
        if (result.ok) { setAssignees(result.data.items); return; }
        setAssigneesError(result.message);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        // Antes un fallo aquí (red o no-`ok`) se ignoraba en silencio -- el selector "Responsable"
        // quedaba con la lista vacía, indistinguible de "todavía no hay personal configurado".
        setAssigneesError(caught instanceof Error ? caught.message : 'No fue posible cargar responsables.');
      });
    return () => controller.abort();
  }, [canManage]);

  // UX audit fix: `/staff/projects/[id]` no remonta este componente al navegar entre dos proyectos
  // distintos (mismo patrón ya confirmado y corregido en el hermano `/staff/requests/[requestId]`,
  // ver commit a52d6ce) -- sin guardia, una respuesta tardía de `load()` para el proyecto ANTERIOR
  // podía pisar en silencio el `workspace` ya cargado del proyecto nuevo (totales de dinero,
  // checklist, responsable) mientras la URL y el encabezado ya mostraban el proyecto correcto.
  const loadGenerationRef = useRef(0);
  const load = useCallback(async () => {
    const generation = (loadGenerationRef.current += 1);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/projects/${projectId}`, { credentials: 'include', cache: 'no-store' });
      const result = await readApiResponse<ProjectWorkspace>(response, 'No fue posible cargar el proyecto.');
      if (loadGenerationRef.current !== generation) return;
      if (!result.ok) {
        if (result.kind === 'forbidden') setAccessDenied(true);
        if (result.kind === 'not_found') setNotFound(true);
        throw new Error(result.message);
      }
      setAccessDenied(false);
      setNotFound(false);
      setWorkspace(result.data);
    } catch (caught) {
      if (loadGenerationRef.current !== generation) return;
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el proyecto.');
    } finally {
      if (loadGenerationRef.current !== generation) return;
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const toggleItem = async (item: ChecklistItem) => {
    const completed = !item.completedAt;
    // Marcado optimista: la casilla responde al instante; la recarga posterior trae quién y cuándo
    // desde el servidor (y revierte si la petición falla).
    setWorkspace((current) => current ? { ...current, checklistItems: current.checklistItems.map((entry) => entry.id === item.id ? { ...entry, completedAt: completed ? new Date().toISOString() : null, completedBy: completed && session ? { displayName: session.user.displayName } : null } : entry) } : current);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/projects/${projectId}/checklist/${item.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed }) });
      await readApiResponseOrThrow(response, 'No fue posible actualizar la tarea.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la tarea.');
    } finally {
      await load();
      setBusy(false);
    }
  };

  // Tareas típicas del arranque de una obra: con el checklist vacío se agregan de un clic (y se
  // completan o se ignoran), en vez de escribirlas cada vez desde cero.
  const addSuggestedItems = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/projects/${projectId}/checklist`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ labels: SUGGESTED_HANDOFF_TASKS }) });
      await readApiResponseOrThrow(response, 'No fue posible agregar las tareas.');
      showToast(`${SUGGESTED_HANDOFF_TASKS.length} tareas de arranque agregadas al checklist.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible agregar las tareas.');
    } finally {
      setBusy(false);
    }
  };

  const addItem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const labels = newItemLabel.split('\n').map((line) => line.trim()).filter(Boolean);
    if (labels.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/projects/${projectId}/checklist`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ labels }) });
      await readApiResponseOrThrow(response, 'No fue posible agregar las tareas.');
      setNewItemLabel('');
      showToast(labels.length === 1 ? 'Tarea agregada al checklist.' : `${labels.length} tareas agregadas al checklist.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible agregar las tareas.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: ProjectStatus) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/projects/${projectId}/status`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
      await readApiResponseOrThrow(response, 'No fue posible actualizar el estado del handoff.');
      setConfirmComplete(false);
      showToast(status === 'COMPLETADO' ? 'Handoff completado.' : 'Handoff reabierto: el proyecto vuelve a estar en transición.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el estado del handoff.');
    } finally {
      setBusy(false);
    }
  };

  const setOwner = async (ownerId: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/projects/${projectId}/owner`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerId: ownerId || null }) });
      await readApiResponseOrThrow(response, 'No fue posible actualizar el responsable.');
      const ownerName = assignees.find((assignee) => assignee.id === ownerId)?.displayName;
      showToast(ownerName ? `${ownerName} ahora coordina este proyecto.` : 'El proyecto quedó sin responsable.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el responsable.');
    } finally {
      setBusy(false);
    }
  };

  if (accessDenied) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/staff" variant="quiet">Volver al dashboard</PrivateLinkButton></div>}>Necesitas un perfil autorizado para consultar este proyecto.</PrivateBlockingState></PrivateSurfaceRoot>;
  }
  if (notFound) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Proyecto no encontrado." action={<div className="private-blocking__actions"><PrivateLinkButton href="/staff/projects">Ver todos los proyectos</PrivateLinkButton><PrivateLinkButton href="/staff" variant="quiet">Volver al dashboard</PrivateLinkButton></div>}>El proyecto no existe o ya no está disponible para tu perfil.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const completedCount = workspace?.checklistItems.filter((item) => item.completedAt).length ?? 0;
  const totalCount = workspace?.checklistItems.length ?? 0;
  const pendingCount = totalCount - completedCount;
  const nextStep = workspace ? projectNextStep({ status: workspace.status, hasOwner: Boolean(workspace.owner), checklistTotal: totalCount, checklistCompleted: completedCount, canManage }) : null;
  const nextStepCta = nextStep?.action ? NEXT_STEP_CTA[nextStep.action] : undefined;

  const goToNextStep = () => {
    const action = nextStep?.action;
    const target = action === 'owner' ? document.getElementById('project-owner')
      : action === 'checklist' ? document.getElementById('project-new-tasks')
        : action === 'tasks' ? document.querySelector<HTMLElement>('#project-checklist input[type="checkbox"]:not(:checked)')
          : null;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  };

  // Cerrar la transición con tareas abiertas es válido (el servidor lo permite), pero rara vez es lo
  // que se quiere: se pide confirmación nombrando cuántas quedan en vez de cerrarla en silencio.
  const requestComplete = () => {
    if (pendingCount > 0) { setConfirmComplete(true); return; }
    void setStatus('COMPLETADO');
  };

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />

      <div className="staff-content handoff-content">
        <Link className="handoff-back" href="/staff/projects"><ChevronLeft size={16} aria-hidden="true" />Todos los proyectos</Link>
        {loading && !workspace && <div className="analytics-loading" role="status" aria-live="polite"><span /><span /><span /><strong>Cargando proyecto…</strong></div>}
        {error && <p className="staff-error" role="alert">{error}</p>}

        {workspace && <>
          <div className="staff-intro handoff-intro">
            <div><p className="staff-kicker">{workspace.folio}</p><h1>{workspace.client.displayName}</h1><p className="staff-intro__copy">{workspace.quoteRequest.projectType} · {workspace.quoteRequest.location} · Expediente <Link href={`/staff/requests?request=${encodeURIComponent(workspace.quoteRequest.id)}`}>{workspace.quoteRequest.folio}</Link></p></div>
            <div className="handoff-intro__side">
              <span className={`staff-status-pill staff-status-pill--${workspace.status === 'COMPLETADO' ? 'sent' : 'pending'}`}>{STATUS_LABELS[workspace.status]}</span>
              {canManage && (workspace.status === 'EN_TRANSICION'
                ? <button className="staff-button staff-button--copper" type="button" disabled={busy} onClick={requestComplete}>Marcar handoff completado</button>
                : <button className="staff-button staff-button--outline" type="button" disabled={busy} onClick={() => void setStatus('EN_TRANSICION')}>Reabrir handoff</button>)}
            </div>
          </div>

          <ExpedienteJourney here="project" requestId={workspace.quoteRequest.id} requestStatus="CONVERTIDA_EN_PROYECTO" quote={{ versionNumber: workspace.acceptedVersion.versionNumber, status: 'ACEPTADA' }} project={{ id: workspace.id, folio: workspace.folio, status: workspace.status }} />

          {nextStep && <section className={`handoff-next handoff-next--${nextStep.tone}`} aria-labelledby="handoff-next-title">
            <span className="handoff-next__icon" aria-hidden="true">{nextStep.tone === 'done' ? <CircleCheck size={19} /> : nextStep.tone === 'waiting' ? <Hourglass size={19} /> : <Compass size={19} />}</span>
            <div className="handoff-next__body"><p className="staff-section-label">Siguiente paso</p><h2 id="handoff-next-title">{nextStep.title}</h2><p>{nextStep.detail}</p></div>
            {nextStepCta && <button className="staff-button staff-button--outline handoff-next__cta" type="button" onClick={goToNextStep}>{nextStepCta}<ArrowRight size={15} aria-hidden="true" /></button>}
          </section>}

          <div className="handoff-layout">
            <section className="handoff-card handoff-scope" aria-label="Resumen del proyecto">
              <header className="handoff-card__head">
                <div><p className="staff-section-label">Alcance aceptado · V{workspace.acceptedVersion.versionNumber}</p><h2>Lo que se va a construir</h2><p className="handoff-card__meta">Firmado por {workspace.acceptedVersion.signerName} · {formatDateTime(workspace.acceptedVersion.acceptedAt)}</p></div>
              </header>
              {[
                ...workspace.acceptedVersion.sections.map((section) => ({ key: section.id, title: section.title, description: section.description, lines: workspace.acceptedVersion.lines.filter((line) => line.sectionId === section.id) })),
                ...(workspace.acceptedVersion.lines.some((line) => !line.sectionId) ? [{ key: 'sin-seccion', title: workspace.acceptedVersion.sections.length ? 'Conceptos generales' : 'Conceptos', description: null, lines: workspace.acceptedVersion.lines.filter((line) => !line.sectionId) }] : []),
              ].map((group) => (
                <div className="handoff-scope__group" key={group.key}>
                  <div className="handoff-scope__group-head"><h3>{group.title}</h3>{group.description && <p>{group.description}</p>}</div>
                  <ul className="handoff-lines">
                    {group.lines.map((line) => <li className="handoff-line" key={line.id}>
                      <span className="handoff-line__name"><strong>{line.name}</strong>{line.description && <small>{line.description}</small>}</span>
                      <span className="handoff-line__qty">{quantityLabel(line.quantityMilliunits)} {line.unit}</span>
                      <span className="handoff-line__total">{moneyLabel(line.totalMinor, workspace.acceptedVersion.currencyCode)}</span>
                    </li>)}
                  </ul>
                </div>
              ))}
              <footer className="handoff-scope__total"><span>Total aceptado</span><strong>{moneyLabel(workspace.acceptedVersion.totalMinor, workspace.acceptedVersion.currencyCode)}</strong></footer>
            </section>

            <div className="handoff-aside">
              <section className="handoff-card" aria-label="Responsable y checklist de transición">
                <header className="handoff-card__head">
                  <div><p className="staff-section-label">Transición</p><h2>Checklist de arranque</h2></div>
                  {totalCount > 0 && <span className="handoff-progress__count">{completedCount} de {totalCount}</span>}
                </header>
                {totalCount > 0 && <div className="handoff-progress" aria-hidden="true"><span style={{ width: `${Math.round((completedCount / totalCount) * 100)}%` }} /></div>}
                <div className="handoff-owner">
                  {canManage
                    ? <PrivateSelect key={workspace.owner?.id ?? 'unassigned'} id="project-owner" optionalHint={false} label="Responsable" value={workspace.owner?.id ?? ''} onValueChange={(value) => void setOwner(value)} options={assignees.map((assignee) => ({ value: assignee.id, label: assignee.displayName }))} placeholder="Sin asignar" disabled={busy} />
                    : <p className="handoff-owner__readonly"><span>Responsable</span><strong>{workspace.owner?.displayName ?? 'Sin asignar'}</strong></p>}
                  <small>{workspace.createdBy.type === 'CUSTOMER' ? 'Se creó al aceptar el cliente la propuesta' : `Creado por ${workspace.createdBy.displayName}`} · {formatDateTime(workspace.createdAt)}</small>
                  {assigneesError && <small className="handoff-owner__error" role="alert">{assigneesError}</small>}
                </div>
                {totalCount === 0 && <div className="handoff-checklist-empty"><strong>Sin tareas de checklist todavía.</strong><span>{canManage ? 'Empieza con las tareas típicas de arranque o escribe las tuyas.' : 'El responsable agregará aquí los pendientes de transición.'}</span>{canManage && <button className="staff-button staff-button--outline handoff-checklist-empty__suggest" type="button" disabled={busy} onClick={() => void addSuggestedItems()}>Agregar tareas de arranque sugeridas</button>}</div>}
                {totalCount > 0 && <ul className="staff-checklist" id="project-checklist">{workspace.checklistItems.map((item) => <li className={`staff-checklist__item${item.completedAt ? ' is-complete' : ''}`} key={item.id}>
                  <label>
                    <input type="checkbox" checked={Boolean(item.completedAt)} disabled={busy || !canManage} onChange={() => void toggleItem(item)} />
                    <span>{item.label}</span>
                  </label>
                  {item.completedAt && item.completedBy && <small>{item.completedBy.displayName} · {formatDateTime(item.completedAt)}</small>}
                </li>)}</ul>}
                {canManage && <form onSubmit={(event) => void addItem(event)} className="handoff-add-tasks">
                  <label><span>Nuevas tareas</span><textarea id="project-new-tasks" value={newItemLabel} onChange={(event) => setNewItemLabel(event.target.value)} maxLength={4000} rows={3} placeholder={'Una tarea por línea, por ejemplo:\nAgendar visita de medición\nConfirmar accesos en sitio'} disabled={busy} /></label>
                  <button className="staff-button staff-button--outline" type="submit" disabled={busy || !newItemLabel.trim()}>{newItemLabel.trim().includes('\n') ? 'Agregar tareas' : 'Agregar tarea'}</button>
                </form>}
              </section>

              <section className="handoff-card handoff-contact" aria-label="Contacto del cliente">
                <header className="handoff-card__head"><div><p className="staff-section-label">Cliente</p><h2>Contacto</h2></div></header>
                <strong className="handoff-contact__name">{workspace.contact.displayName}</strong>
                <a href={`mailto:${workspace.contact.email}`}>{workspace.contact.email}</a>
                {workspace.contact.phone && <a href={`tel:${workspace.contact.phone}`}>{workspace.contact.phone}</a>}
              </section>

              <section className="handoff-card" aria-label="Actividad del proyecto">
                <header className="handoff-card__head"><div><p className="staff-section-label">Trazabilidad</p><h2>Actividad</h2></div></header>
                <ol className="handoff-activity">{workspace.activity.map((entry) => <li key={entry.id}><span>{ACTIVITY_LABELS[entry.action] ?? entry.action}</span><time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time></li>)}</ol>
              </section>
            </div>
          </div>

          {confirmComplete && <PrivateDialog open onClose={() => { if (!busy) setConfirmComplete(false); }} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="handoff-confirm-title" describedBy="handoff-confirm-description">
            <div className="quotes-preflight-dialog__head"><h3 id="handoff-confirm-title">¿Cerrar la transición con tareas abiertas?</h3><button className="staff-dialog-close" type="button" onClick={() => setConfirmComplete(false)} disabled={busy} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
            <p id="handoff-confirm-description" className="quotes-preflight-dialog__copy">{pendingCount === 1 ? 'Queda 1 tarea del checklist sin completar.' : `Quedan ${pendingCount} tareas del checklist sin completar.`} Puedes completarlas primero o cerrar de todos modos; siempre podrás reabrir el handoff.</p>
            <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setConfirmComplete(false)} disabled={busy}>Revisar tareas</button><button className="staff-button staff-button--copper" type="button" disabled={busy} onClick={() => void setStatus('COMPLETADO')}>{busy ? 'Guardando…' : 'Cerrar de todos modos'}</button></div>
          </PrivateDialog>}
        </>}
      </div>
    </PrivateSurfaceRoot>
  );
}
