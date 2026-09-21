'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffTopNav from '@/components/StaffTopNav';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton, PrivateSelect } from '@/components/private/ui';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { formatDateTime } from '@/lib/format-date';
import { moneyLabel } from '@/lib/money';

type ProjectStatus = 'EN_TRANSICION' | 'COMPLETADO';

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
  createdBy: { id: string; displayName: string };
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
};

function quantityLabel(milliunits: string): string {
  if (!/^\d+$/.test(milliunits)) return '—';
  return (Number(milliunits) / 1000).toLocaleString('es-MX', { maximumFractionDigits: 3 });
}


export default function StaffProjectWorkspacePanel({ projectId }: { projectId: string }) {
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [assignees, setAssignees] = useState<Array<{ id: string; displayName: string }>>([]);
  const [assigneesError, setAssigneesError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/projects/${projectId}`, { credentials: 'include', cache: 'no-store' });
      const result = await readApiResponse<ProjectWorkspace>(response, 'No fue posible cargar el proyecto.');
      if (!result.ok) {
        if (result.kind === 'forbidden') setAccessDenied(true);
        if (result.kind === 'not_found') setNotFound(true);
        throw new Error(result.message);
      }
      setAccessDenied(false);
      setNotFound(false);
      setWorkspace(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el proyecto.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const toggleItem = async (item: ChecklistItem) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/projects/${projectId}/checklist/${item.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed: !item.completedAt }) });
      await readApiResponseOrThrow(response, 'No fue posible actualizar la tarea.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la tarea.');
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
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Proyecto no encontrado." action={<PrivateLinkButton href="/staff">Volver al dashboard</PrivateLinkButton>}>El proyecto no existe o ya no está disponible para tu perfil.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <header className="staff-header">
        <WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" />
        <StaffTopNav />
        <div className="staff-header__tools"><Link className="staff-header__home" href="/staff">Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Handoff a proyecto</div></div>
      </header>

      <div className="staff-content staff-notifications">
        {loading && !workspace && <div className="analytics-loading" role="status" aria-live="polite"><span /><span /><span /><strong>Cargando proyecto…</strong></div>}
        {error && <p className="staff-error" role="alert">{error}</p>}

        {workspace && <>
          <div className="staff-intro">
            <div><p className="staff-kicker">{workspace.folio}</p><h1>{workspace.client.displayName}</h1><p className="staff-intro__copy">{workspace.quoteRequest.projectType} · {workspace.quoteRequest.location} · Expediente <Link href={`/staff/requests?request=${encodeURIComponent(workspace.quoteRequest.id)}`}>{workspace.quoteRequest.folio}</Link></p></div>
            <span className={`staff-status-pill staff-status-pill--${workspace.status === 'COMPLETADO' ? 'sent' : 'pending'}`}>{STATUS_LABELS[workspace.status]}</span>
          </div>

          <section className="staff-notification-workspace" aria-label="Resumen del proyecto">
            <div className="staff-notification-toolbar">
              <div className="staff-notification-toolbar__summary"><span>Alcance aceptado · V{workspace.acceptedVersion.versionNumber}</span><small>Firmado por {workspace.acceptedVersion.signerName} · {formatDateTime(workspace.acceptedVersion.acceptedAt)}</small></div>
            </div>
            <div className="staff-notification-list">
              <ul>
                {workspace.acceptedVersion.sections.map((section) => <li className="staff-notification-row" key={section.id}>
                  <div className="staff-notification-row__identity"><strong>{section.title}</strong>{section.description && <small>{section.description}</small>}</div>
                  <dl className="staff-notification-row__facts">{workspace.acceptedVersion.lines.filter((line) => line.sectionId === section.id).map((line) => <div key={line.id}><dt>{line.name}</dt><dd>{quantityLabel(line.quantityMilliunits)} {line.unit} · {moneyLabel(line.totalMinor, workspace.acceptedVersion.currencyCode)}</dd></div>)}</dl>
                </li>)}
                {workspace.acceptedVersion.lines.filter((line) => !line.sectionId).length > 0 && <li className="staff-notification-row" key="sin-seccion">
                  <div className="staff-notification-row__identity"><strong>Sin sección</strong></div>
                  <dl className="staff-notification-row__facts">{workspace.acceptedVersion.lines.filter((line) => !line.sectionId).map((line) => <div key={line.id}><dt>{line.name}</dt><dd>{quantityLabel(line.quantityMilliunits)} {line.unit} · {moneyLabel(line.totalMinor, workspace.acceptedVersion.currencyCode)}</dd></div>)}</dl>
                </li>}
              </ul>
              <p className="staff-notification-row__reason">Total aceptado: <strong>{moneyLabel(workspace.acceptedVersion.totalMinor, workspace.acceptedVersion.currencyCode)}</strong></p>
            </div>
          </section>

          <section className="staff-notification-workspace" aria-label="Responsable y checklist de transición">
            <div className="staff-notification-toolbar">
              <div className="staff-notification-toolbar__summary"><PrivateSelect key={workspace.owner?.id ?? 'unassigned'} id="project-owner" label="Responsable" value={workspace.owner?.id ?? ''} onValueChange={(value) => void setOwner(value)} options={assignees.map((assignee) => ({ value: assignee.id, label: assignee.displayName }))} placeholder="Sin asignar" disabled={busy} /><small>Creado por {workspace.createdBy.displayName} · {formatDateTime(workspace.createdAt)}</small>{assigneesError && <small className="staff-error" role="alert">{assigneesError}</small>}</div>
              {workspace.status === 'EN_TRANSICION'
                ? <button className="staff-button staff-button--copper" type="button" disabled={busy} onClick={() => void setStatus('COMPLETADO')}>Marcar handoff completado</button>
                : <button className="staff-button staff-button--outline" type="button" disabled={busy} onClick={() => void setStatus('EN_TRANSICION')}>Reabrir handoff</button>}
            </div>
            <div className="staff-notification-list">
              {workspace.checklistItems.length === 0 && <div className="staff-empty staff-empty--compact"><h2>Sin tareas de checklist todavía.</h2><p>Agrega los pendientes de transición para este proyecto.</p></div>}
              {workspace.checklistItems.length > 0 && <ul className="staff-checklist">{workspace.checklistItems.map((item) => <li className={`staff-checklist__item${item.completedAt ? ' is-complete' : ''}`} key={item.id}>
                <label>
                  <input type="checkbox" checked={Boolean(item.completedAt)} disabled={busy} onChange={() => void toggleItem(item)} />
                  <span>{item.label}</span>
                </label>
                {item.completedAt && item.completedBy && <small>{item.completedBy.displayName} · {formatDateTime(item.completedAt)}</small>}
              </li>)}</ul>}
            </div>
            <form onSubmit={(event) => void addItem(event)} className="catalog-form">
              <label><span>Nuevas tareas</span><textarea value={newItemLabel} onChange={(event) => setNewItemLabel(event.target.value)} maxLength={4000} rows={3} placeholder={'Una tarea por línea, por ejemplo:\nAgendar visita de medición\nConfirmar accesos en sitio'} disabled={busy} /></label>
              <button className="staff-button staff-button--outline" type="submit" disabled={busy || !newItemLabel.trim()}>{newItemLabel.trim().includes('\n') ? 'Agregar tareas' : 'Agregar tarea'}</button>
            </form>
          </section>

          <section className="staff-notification-workspace" aria-label="Actividad del proyecto">
            <div className="staff-notification-toolbar"><div className="staff-notification-toolbar__summary"><span>Actividad</span></div></div>
            <ul className="staff-workqueue__list">{workspace.activity.map((entry) => <li key={entry.id}><span className="staff-workqueue__client">{ACTIVITY_LABELS[entry.action] ?? entry.action}</span><span className="staff-workqueue__age">{formatDateTime(entry.createdAt)}</span></li>)}</ul>
          </section>
        </>}
      </div>
    </PrivateSurfaceRoot>
  );
}
