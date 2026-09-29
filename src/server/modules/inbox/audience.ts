import type { Prisma } from '@/generated/prisma/client';

export type InboxActor = Readonly<{ userId: string; type: 'CUSTOMER' | 'EMPLOYEE' }>;
export type InboxRecipient = Readonly<{ id: string; displayName: string }>;

/** Grupos de destinatarios por permiso (spec §2.2). Siempre empleados ACTIVE. */
export const POOL_PERMISSIONS = ['requests.claim', 'requests.read.global'] as const;
export const MANAGER_PERMISSIONS = ['requests.read.global'] as const;
export const APPROVER_PERMISSIONS = ['quotes.approve_discount'] as const;
export const PRICE_MANAGER_PERMISSIONS = ['prices.manage'] as const;

export type RequestInboxContext = Readonly<{
  id: string;
  folio: string;
  status: string;
  origin: 'PUBLIC_FORM' | 'STAFF_CREATED';
  clientId: string;
  clientName: string;
  /** Sólo si la persona asignada sigue ACTIVE; si no, el expediente cuenta como sin responsable. */
  assigneeId: string | null;
  assigneeName: string | null;
  contactName: string;
  /** Cuenta de portal ACTIVE del contacto (con el cliente ACTIVE); sin ella el cliente sólo recibe correo. */
  customerUserId: string | null;
  projectType: string | null;
  location: string | null;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function uuidOf(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export async function loadRequestInboxContext(tx: Prisma.TransactionClient, quoteRequestId: string): Promise<RequestInboxContext | null> {
  const request = await tx.quoteRequest.findUnique({
    where: { id: quoteRequestId },
    select: {
      id: true,
      folio: true,
      status: true,
      origin: true,
      clientId: true,
      client: { select: { displayName: true, status: true } },
      currentAssignee: { select: { id: true, displayName: true, type: true, status: true } },
      contact: { select: { displayName: true, status: true, user: { select: { id: true, type: true, status: true } } } },
      detail: { select: { projectType: true, location: true } },
    },
  });
  if (!request) return null;
  const assignee = request.currentAssignee?.type === 'EMPLOYEE' && request.currentAssignee.status === 'ACTIVE' ? request.currentAssignee : null;
  const contactUser = request.client.status === 'ACTIVE' && request.contact.status === 'ACTIVE' && request.contact.user?.type === 'CUSTOMER' && request.contact.user.status === 'ACTIVE' ? request.contact.user : null;
  return {
    id: request.id,
    folio: request.folio,
    status: request.status,
    origin: request.origin,
    clientId: request.clientId,
    clientName: request.client.displayName,
    assigneeId: assignee?.id ?? null,
    assigneeName: assignee?.displayName ?? null,
    contactName: request.contact.displayName,
    customerUserId: contactUser?.id ?? null,
    projectType: request.detail?.projectType ?? null,
    location: request.detail?.location ?? null,
  };
}

export async function activeStaffWithPermissions(tx: Prisma.TransactionClient, permissionKeys: readonly string[]): Promise<InboxRecipient[]> {
  return tx.user.findMany({
    where: { type: 'EMPLOYEE', status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: { in: [...permissionKeys] } } } } } } } },
    select: { id: true, displayName: true },
    orderBy: { id: 'asc' },
  });
}

export async function activeEmployees(tx: Prisma.TransactionClient, userIds: readonly (string | null | undefined)[]): Promise<InboxRecipient[]> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return [];
  return tx.user.findMany({ where: { id: { in: ids }, type: 'EMPLOYEE', status: 'ACTIVE' }, select: { id: true, displayName: true }, orderBy: { id: 'asc' } });
}

export async function displayNameOf(tx: Prisma.TransactionClient, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return user?.displayName ?? null;
}

/** Nunca se avisa a quien hizo la acción. */
export function excludeUser<T extends { id: string }>(users: readonly T[], userId: string | null | undefined): T[] {
  return userId ? users.filter((user) => user.id !== userId) : [...users];
}
