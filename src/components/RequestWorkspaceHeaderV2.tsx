'use client';

import Link from 'next/link';
import { PrivateButton, PrivateMenu } from '@/components/private/ui';
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
          {secondaryActions.length > 0 && <PrivateMenu triggerLabel="Más acciones" panelId="request-workspace-v2-more-actions" panelLabel="Más acciones del expediente" items={secondaryActions} />}
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
