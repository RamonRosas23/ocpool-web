'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { usePrivateToast } from '@/components/private/ui/PrivateToast';
import { useStaffSession } from '@/components/staff/StaffSessionContext';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import type { InboxNotification } from '@/lib/inbox-client';
import { useInbox } from './InboxProvider';

type Options = Readonly<{
  /** Al seguir un enlace de acción ("Decidir", "Responder"): marcar como leído, cerrar el panel… */
  onOpen: (item: InboxNotification) => void;
  /** Después de "Tomar", funcione o no: quien muestra su propia lista la vuelve a pedir. */
  onChanged?: () => void;
}>;

/** Acciones rápidas de un aviso (spec §5.1): las mismas en la campana y en la página. */
export function useInboxActions({ onOpen, onChanged }: Options): (item: InboxNotification) => ReactNode {
  const inbox = useInbox();
  const session = useStaffSession();
  const { showToast } = usePrivateToast();
  const [takingId, setTakingId] = useState<string | null>(null);

  const take = async (item: InboxNotification) => {
    if (!item.quoteRequestId) return;
    setTakingId(item.id);
    try {
      const response = await fetch(`/api/staff/quote-requests/${item.quoteRequestId}/take`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      await readApiResponseOrThrow(response, 'No fue posible tomar la solicitud.');
      showToast(`Tomaste ${item.folio ?? 'la solicitud'}.`);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'No fue posible tomar la solicitud.', { tone: 'error' });
    } finally {
      setTakingId(null);
      // También si falló: si alguien más la tomó primero, el aviso ya dice "Tomada por …".
      await inbox?.refresh();
      onChanged?.();
    }
  };

  return function actionsFor(item: InboxNotification): ReactNode {
    if (item.kind === 'request.new_unassigned' && session?.capabilities.requestsClaim) {
      return <button type="button" className="inbox-action" disabled={takingId === item.id} onClick={() => void take(item)}>{takingId === item.id ? 'Tomando…' : 'Tomar'}</button>;
    }
    if (item.kind === 'approval.requested') return <Link className="inbox-action" href="/staff/approvals" onClick={() => onOpen(item)}>Decidir</Link>;
    if (item.kind === 'customer.activity' || item.kind === 'quote.changes_requested') return <Link className="inbox-action" href={item.actionPath} onClick={() => onOpen(item)}>Responder</Link>;
    return null;
  };
}
