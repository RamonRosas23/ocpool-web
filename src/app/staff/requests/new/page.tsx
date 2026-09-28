import type { Metadata } from 'next';
import StaffRequestCreateV2Panel from '@/components/StaffRequestCreateV2Panel';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';

export const metadata: Metadata = {
  title: 'Nueva solicitud | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

// El alta manual existe en ambas vistas: sin la bandeja V2, se usa la vista clásica de Solicitudes.
export default function NewStaffRequestPage() {
  const flags = readCommercialV2Flags();
  return <StaffRequestCreateV2Panel classic={!flags.commercialWorkspaceV2 || !flags.requestWorkspaceV2} />;
}
