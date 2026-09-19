import type { ReactNode } from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { PrivateButton } from './PrivateControls';

export function PrivateStatus({ tone = 'status', children }: { tone?: 'status' | 'error' | 'success'; children: ReactNode }) {
  return <p className={`private-status private-status--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>;
}

export function PrivateSkeleton({ label = 'Cargando' }: { label?: string }) {
  return <div className="private-skeleton" role="status" aria-label={label} aria-busy="true"><i /><i /><i /></div>;
}

export function PrivateEmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <section className="private-empty" aria-live="polite"><span className="private-empty__mark" aria-hidden="true"><Inbox size={18} /></span><h2>{title}</h2>{children && <p>{children}</p>}{action}</section>;
}

export function PrivateBlockingState({ title, children, onRetry, action }: { title: string; children: ReactNode; onRetry?: () => void; action?: ReactNode }) {
  return <section className="private-blocking" role="alert"><span className="private-blocking__mark" aria-hidden="true"><AlertTriangle size={18} /></span><h2>{title}</h2><p>{children}</p>{onRetry && <PrivateButton type="button" variant="secondary" onClick={onRetry}>Reintentar</PrivateButton>}{action}</section>;
}
