'use client';

import { X } from 'lucide-react';
import type { InboxNotification } from '@/lib/inbox-client';

export default function SinceLastVisitBanner({ items, onDismiss }: Readonly<{ items: readonly InboxNotification[]; onDismiss: () => void }>) {
  if (items.length === 0) return null;
  return (
    <section className="client-since" aria-label="Novedades desde tu última visita">
      <div>
        <p className="client-eyebrow">Desde tu última visita</p>
        <ul>{items.slice(0, 4).map((item) => <li key={item.id}>{item.title}</li>)}</ul>
      </div>
      <button type="button" className="client-since__dismiss" aria-label="Ocultar novedades" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
    </section>
  );
}
