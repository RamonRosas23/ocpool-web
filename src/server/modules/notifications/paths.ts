import { readCommercialV2Flags, type CommercialV2Flags } from '@/server/flags/commercial-v2';

export type StaffRequestTab = 'summary' | 'quote' | 'conversation' | 'files' | 'activity';

export function requestWorkspaceNotificationPath(requestId: string, tab: StaffRequestTab, flags: CommercialV2Flags = readCommercialV2Flags()): string {
  if (flags.commercialWorkspaceV2 && flags.requestWorkspaceV2) return `/staff/requests/${encodeURIComponent(requestId)}?tab=${tab}`;
  // La vista clásica también abre un expediente por `?request=` (lista + detalle en la misma página;
  // conversación y archivos van en el detalle, así que no hay pestaña). Antes el correo llevaba a la
  // lista a secas y había que buscar el folio a mano.
  return `/staff/requests?request=${encodeURIComponent(requestId)}`;
}
