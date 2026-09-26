'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { PrivateStaffCapabilities } from '@/components/private/navigation';

export type StaffSession = {
  user: { displayName: string; email: string };
  roleLabel: string;
  capabilities: PrivateStaffCapabilities;
};

const StaffSessionContext = createContext<StaffSession | null>(null);

// La sesión se resuelve en el layout de servidor (una sola lectura por navegación) y se reparte
// aquí para que el header compartido muestre identidad, permisos y "Cerrar sesión" sin que cada
// panel tenga que volver a pedirla. `null` significa "sin sesión de empleado": el header sigue
// mostrando la navegación completa y cada panel resuelve su propio estado restringido.
export function StaffSessionProvider({ session, children }: { session: StaffSession | null; children: ReactNode }) {
  return <StaffSessionContext.Provider value={session}>{children}</StaffSessionContext.Provider>;
}

export function useStaffSession(): StaffSession | null {
  return useContext(StaffSessionContext);
}
