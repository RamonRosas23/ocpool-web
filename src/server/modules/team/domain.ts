// Reglas del equipo interno (sin dependencias de servidor: también las usa la pantalla Equipo).

/** Roles que se asignan desde Equipo. Administrador exige MFA y se crea con `npm run admin:bootstrap`. */
export const TEAM_ROLES = ['sales', 'manager'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export type TeamRoleKey = TeamRole | 'admin';

export const TEAM_ROLE_LABELS: Record<TeamRoleKey, string> = {
  sales: 'Ventas',
  manager: 'Gerencia',
  admin: 'Administrador',
};

/** Qué puede hacer cada rol, en lenguaje de negocio (lo que se explica al elegirlo). */
export const TEAM_ROLE_DESCRIPTIONS: Record<TeamRoleKey, string> = {
  sales: 'Atiende solicitudes, cotiza y da seguimiento a sus expedientes y proyectos. Los descuentos que pasan del límite requieren aprobación de gerencia.',
  manager: 'Todo lo de Ventas, más: ve y reasigna todos los expedientes, aprueba descuentos, administra catálogo y precios, consulta la auditoría y administra el equipo.',
  admin: 'Acceso completo a la plataforma con verificación en dos pasos obligatoria. Se administra con el procedimiento seguro por terminal.',
};

export function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

/** El rol que se muestra: administrador por encima de gerencia, gerencia por encima de ventas. */
export function primaryTeamRole(roleKeys: readonly string[]): TeamRoleKey | null {
  if (roleKeys.includes('admin')) return 'admin';
  if (roleKeys.includes('manager')) return 'manager';
  if (roleKeys.includes('sales')) return 'sales';
  return null;
}

export const TEAM_VIEWS = ['active', 'invited', 'suspended', 'all'] as const;
export type TeamView = (typeof TEAM_VIEWS)[number];

export type TeamMemberState = 'active' | 'invited' | 'invitation_expired' | 'suspended';

export const TEAM_MEMBER_STATE_LABELS: Record<TeamMemberState, string> = {
  active: 'Activa',
  invited: 'Invitación pendiente',
  invitation_expired: 'Invitación vencida',
  suspended: 'Suspendida',
};

/** Estado visible de una persona: la invitación vencida se distingue para ofrecer reenviarla. */
export function teamMemberState(input: { status: string; invitationExpiresAt: Date | string | null }, now: Date = new Date()): TeamMemberState {
  if (input.status === 'ACTIVE') return 'active';
  if (input.status === 'INVITED') return input.invitationExpiresAt && new Date(input.invitationExpiresAt).getTime() > now.getTime() ? 'invited' : 'invitation_expired';
  return 'suspended';
}

export function teamViewIncludes(view: TeamView, state: TeamMemberState): boolean {
  if (view === 'all') return true;
  if (view === 'active') return state === 'active';
  if (view === 'invited') return state === 'invited' || state === 'invitation_expired';
  return state === 'suspended';
}

export type TeamMemberLock = 'self' | 'admin';

/**
 * Por qué una cuenta no se administra desde Equipo: la propia (evita bloquearse por accidente) o la
 * de un administrador (evita escaladas y que la plataforma quede sin administración). null: sí se puede.
 */
export function teamMemberLock(input: { actorUserId: string; memberId: string; roleKeys: readonly string[] }): TeamMemberLock | null {
  if (input.actorUserId === input.memberId) return 'self';
  if (input.roleKeys.includes('admin')) return 'admin';
  return null;
}

export const TEAM_MEMBER_LOCK_MESSAGES: Record<TeamMemberLock, string> = {
  self: 'Es tu cuenta: tu rol y tu acceso los administra otra persona con permiso de equipo.',
  admin: 'Las cuentas de administrador se gestionan con el procedimiento seguro (verificación en dos pasos).',
};
