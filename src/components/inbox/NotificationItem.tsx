'use client';

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import { formatDateTime } from '@/lib/format-date';
import { isUnread, type InboxNotification } from '@/lib/inbox-client';
import { relativeTimeLabel } from '@/lib/relative-time';
import { inboxKindVisual } from './inbox-visuals';

type Props = Readonly<{
  item: InboxNotification;
  onOpen: (item: InboxNotification, event: MouseEvent<HTMLAnchorElement>) => void;
  actions?: ReactNode;
}>;

export default function NotificationItem({ item, onOpen, actions }: Props) {
  const visual = inboxKindVisual(item.kind);
  const Icon = visual.icon;
  const unread = isUnread(item);
  // Folio y cliente sólo si el título o el cuerpo no los dicen ya (p. ej. "Sofía Garza · OCQ-2026-000130").
  const meta = [item.folio, item.clientName].filter((part): part is string => typeof part === 'string' && part.length > 0 && !item.title.includes(part) && !item.body?.includes(part)).join(' · ');
  const className = ['inbox-item', unread ? 'is-unread' : '', item.resolvedAt ? 'is-resolved' : '', item.priority === 'URGENT' ? 'is-urgent' : ''].filter(Boolean).join(' ');
  return (
    <li className={className}>
      <span className={`inbox-item__icon inbox-item__icon--${visual.tone}`} aria-hidden="true"><Icon size={16} /></span>
      <div className="inbox-item__main">
        <Link className="inbox-item__link" href={item.actionPath} onClick={(event) => onOpen(item, event)}>
          <strong>{item.title}</strong>
          {item.body && <span className="inbox-item__body">{item.body}</span>}
        </Link>
        <span className="inbox-item__meta">
          {meta && <span>{meta}</span>}
          <time dateTime={item.lastActivityAt} title={formatDateTime(item.lastActivityAt)}>{relativeTimeLabel(item.lastActivityAt)}</time>
        </span>
        {item.resolvedNote && <span className="inbox-item__resolved">{item.resolvedNote}</span>}
        {actions && !item.resolvedAt && <div className="inbox-item__actions">{actions}</div>}
      </div>
      {unread && <span className="inbox-item__dot"><span className="sr-only">Sin leer</span></span>}
    </li>
  );
}
