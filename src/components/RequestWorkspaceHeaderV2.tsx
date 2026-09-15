'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { PrivateButton } from '@/components/private/ui';
import type { RequestWorkspacePrimaryAction } from '@/lib/request-workspace-primary-action';
import type { QuoteRequestStatus } from '@/server/modules/quote-requests/domain';

export type RequestWorkspaceHeaderAction = {
  key: string;
  label: string;
  description: string;
  href?: string;
  onActivate?: () => void;
};

type RequestWorkspaceHeaderV2Props = {
  backHref: string;
  primaryAction: RequestWorkspacePrimaryAction | null;
  primaryHref?: string;
  onPrimaryAction: (action: RequestWorkspacePrimaryAction) => void;
  secondaryActions: readonly RequestWorkspaceHeaderAction[];
  detail: {
    folio: string;
    origin: string;
    status: QuoteRequestStatus;
    statusLabel: string;
    createdAtLabel: string;
    clientName: string;
    projectType: string;
    projectStage: string;
    assigneeName: string;
    expectedActor: string;
    attention: string;
  };
};

export default function RequestWorkspaceHeaderV2({ backHref, primaryAction, primaryHref, onPrimaryAction, secondaryActions, detail }: RequestWorkspaceHeaderV2Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('pointerdown', closeOnPointerDown);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('pointerdown', closeOnPointerDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, [menuOpen]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const currentIndex = Math.max(items.indexOf(document.activeElement as HTMLElement), 0);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const activatePrimary = () => {
    if (!primaryAction) return;
    if (primaryAction.kind === 'quote' && primaryHref) return;
    onPrimaryAction(primaryAction);
  };

  return <div className="request-workspace-v2__detail-context">
    <Link className="request-workspace-v2__back" href={backHref}>← Volver a solicitudes</Link>
    <header className="request-workspace-v2__detail-header" aria-labelledby="request-workspace-v2-detail-title">
      <div className="request-workspace-v2__detail-identity">
        <p className="private-kicker">{detail.origin === 'PUBLIC_FORM' ? 'Solicitud pública' : 'Solicitud interna'}</p>
        <h1 id="request-workspace-v2-detail-title">{detail.folio}</h1>
        <p>Recibida el {detail.createdAtLabel}</p>
      </div>
      <div className="request-workspace-v2__detail-header-side">
        <span className={`request-workspace-v2__detail-status request-workspace-v2__detail-status--${detail.status.toLowerCase()}`} aria-label={`Estado: ${detail.statusLabel}`}>{detail.statusLabel}</span>
        <div className="request-workspace-v2__detail-actionbar">
          {primaryAction && (primaryAction.kind === 'quote' && primaryHref ? <Link className="private-button private-button--primary" href={primaryHref}>{primaryAction.label}</Link> : <PrivateButton id="request-workspace-v2-primary-action" type="button" title={primaryAction.description} onClick={activatePrimary}>{primaryAction.label}</PrivateButton>)}
          {secondaryActions.length > 0 && <div className="request-workspace-v2__action-menu" ref={menuRef}>
            <PrivateButton ref={menuButtonRef} type="button" variant="quiet" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="request-workspace-v2-more-actions" onClick={() => setMenuOpen((current) => !current)}>Más acciones</PrivateButton>
            {menuOpen && <div id="request-workspace-v2-more-actions" className="request-workspace-v2__action-menu-panel" role="menu" aria-label="Más acciones del expediente" onKeyDown={handleMenuKeyDown}>
              {secondaryActions.map((action) => action.href ? <Link key={action.key} role="menuitem" href={action.href} onClick={() => setMenuOpen(false)}><strong>{action.label}</strong><small>{action.description}</small></Link> : <button key={action.key} type="button" role="menuitem" onClick={() => { setMenuOpen(false); action.onActivate?.(); }}><strong>{action.label}</strong><small>{action.description}</small></button>)}
            </div>}
          </div>}
        </div>
      </div>
    </header>
    <dl className="request-workspace-v2__detail-meta" aria-label="Contexto del expediente">
      <div><dt>Cliente</dt><dd>{detail.clientName}</dd></div>
      <div><dt>Proyecto</dt><dd>{detail.projectType}</dd></div>
      <div><dt>Etapa</dt><dd>{detail.projectStage}</dd></div>
      <div><dt>Responsable</dt><dd>{detail.assigneeName}</dd></div>
      <div><dt>Siguiente actor</dt><dd>{detail.expectedActor}</dd></div>
      <div><dt>Atención</dt><dd>{detail.attention}</dd></div>
    </dl>
  </div>;
}
