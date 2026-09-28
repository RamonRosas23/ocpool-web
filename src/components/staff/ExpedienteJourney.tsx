'use client';

import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { useStaffSession } from '@/components/staff/StaffSessionContext';
import { QUOTE_REQUEST_STATUS_LABELS, QUOTE_VERSION_STATUS_LABELS } from '@/lib/labels';

type Stage = 'request' | 'quote' | 'project';
type StepState = 'done' | 'current' | 'upcoming' | 'closed';

export type ExpedienteJourneyProps = {
  /** Pestaña desde la que se ve el expediente (esa etapa no es enlace). */
  here: Stage;
  requestId: string;
  requestStatus: string;
  /** validUntil: una propuesta enviada con la vigencia vencida se muestra como "Vencida". */
  quote: { versionNumber: number; status: string; validUntil?: string | null } | null;
  project: { id: string; folio: string; status: string } | null;
};

const REQUEST_STAGE_STATUSES = ['RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA'];
const CLOSED_STATUSES = ['RECHAZADA', 'VENCIDA'];

/** En qué etapa va el expediente, según el estado de la solicitud y si ya tiene proyecto. */
export function expedienteStage(requestStatus: string, hasProject: boolean): Stage {
  if (hasProject || requestStatus === 'CONVERTIDA_EN_PROYECTO') return 'project';
  if (REQUEST_STAGE_STATUSES.includes(requestStatus)) return 'request';
  return 'quote';
}

function stepState(step: Stage, current: Stage, closed: boolean, projectDone: boolean): StepState {
  const order: Stage[] = ['request', 'quote', 'project'];
  const position = order.indexOf(step);
  const currentPosition = order.indexOf(current);
  if (position < currentPosition) return 'done';
  if (position > currentPosition) return 'upcoming';
  if (closed) return 'closed';
  return step === 'project' && projectDone ? 'done' : 'current';
}

/**
 * Un mismo expediente vive en tres pestañas (Solicitudes, Cotizaciones y Proyectos). Esta franja
 * dice en qué etapa va y lleva a la vista de cada etapa, para que nadie tenga que adivinar en qué
 * pestaña seguir ni pierda el hilo al pasar de una a otra.
 */
export default function ExpedienteJourney({ here, requestId, requestStatus, quote, project }: ExpedienteJourneyProps) {
  const session = useStaffSession();
  const capabilities = session?.capabilities;
  const closed = CLOSED_STATUSES.includes(requestStatus);
  // Un expediente cerrado se marca en la etapa donde se quedó: con propuesta, en Cotización; sin ella,
  // en Solicitud (antes la solicitud salía con palomita "Cerrada" como si fuera un avance).
  const closedAt: Stage | null = closed ? (quote ? 'quote' : 'request') : null;
  const current = closedAt ?? expedienteStage(requestStatus, Boolean(project));
  const projectDone = project?.status === 'COMPLETADO';
  const quoteStatus = quote && (quote.status === 'ENVIADA' || quote.status === 'EN_NEGOCIACION') && quote.validUntil && new Date(quote.validUntil).getTime() < Date.now() ? 'VENCIDA' : quote?.status ?? null;
  const steps: Array<{ stage: Stage; label: string; detail: string; href: string | null }> = [
    {
      stage: 'request',
      label: 'Solicitud',
      detail: current === 'request' ? (QUOTE_REQUEST_STATUS_LABELS as Record<string, string>)[requestStatus] ?? requestStatus : 'Revisada',
      href: capabilities?.requestsRead === false ? null : `/staff/requests?request=${encodeURIComponent(requestId)}`,
    },
    {
      stage: 'quote',
      label: 'Cotización',
      detail: quote ? `V${quote.versionNumber} · ${closedAt === 'quote' ? 'Expediente cerrado' : (quoteStatus ? (QUOTE_VERSION_STATUS_LABELS as Record<string, string>)[quoteStatus] ?? quoteStatus : '')}` : current === 'request' ? 'Aún no' : 'Por preparar',
      href: capabilities?.quotesRead === false || (!quote && current === 'request') ? null : `/staff/quotes?request=${encodeURIComponent(requestId)}`,
    },
    {
      stage: 'project',
      label: 'Proyecto',
      detail: project ? `${project.folio} · ${project.status === 'COMPLETADO' ? 'Completado' : 'En arranque'}` : 'Al aceptar el cliente',
      href: project && capabilities?.projectsRead !== false ? `/staff/projects/${encodeURIComponent(project.id)}` : null,
    },
  ];

  return <nav className="expediente-journey" aria-label="Recorrido del expediente">
    <ol>
      {steps.map((step, index) => {
        const state = stepState(step.stage, current, closed, projectDone);
        const isHere = step.stage === here;
        const content = <>
          <span className="expediente-journey__marker" aria-hidden="true">{state === 'done' ? <Check size={12} strokeWidth={2.8} /> : state === 'closed' ? <X size={12} strokeWidth={2.8} /> : index + 1}</span>
          <span className="expediente-journey__text"><strong>{step.label}</strong><small>{step.detail}</small></span>
        </>;
        return <li key={step.stage} className={`expediente-journey__step is-${state}${isHere ? ' is-here' : ''}`}>
          {isHere || !step.href
            ? <span className="expediente-journey__item" aria-current={isHere ? 'page' : undefined}>{content}{isHere && <span className="sr-only"> (estás aquí)</span>}</span>
            : <Link className="expediente-journey__item" href={step.href}>{content}</Link>}
        </li>;
      })}
    </ol>
  </nav>;
}
