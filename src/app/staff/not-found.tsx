import type { Metadata } from 'next';
import { Compass } from 'lucide-react';
import StaffHeader from '@/components/StaffHeader';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateLinkButton } from '@/components/private/ui';

export const metadata: Metadata = {
  title: 'Página no encontrada | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

// Cualquier `notFound()` dentro de /staff (una ruta V2 con su bandera apagada, un expediente que
// ya no existe) caía en la 404 genérica de Next, sin marca ni navegación: el usuario quedaba
// fuera del espacio de trabajo. Aquí conserva el header completo y dos salidas claras.
export default function StaffNotFound() {
  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />
      <div className="staff-content staff-not-found">
        <section className="staff-not-found__card" aria-labelledby="staff-not-found-title">
          <span className="staff-empty__mark" aria-hidden="true"><Compass size={20} /></span>
          <p className="staff-kicker">Error 404</p>
          <h1 id="staff-not-found-title">No encontramos esta página.</h1>
          <p>Puede que el enlace esté incompleto o que esta vista todavía no esté habilitada para tu cuenta.</p>
          <div className="staff-not-found__actions">
            <PrivateLinkButton href="/staff">Ir al dashboard</PrivateLinkButton>
            <PrivateLinkButton href="/staff/requests" variant="quiet">Ver solicitudes</PrivateLinkButton>
          </div>
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
