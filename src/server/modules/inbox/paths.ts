import { requestWorkspaceNotificationPath, type StaffRequestTab } from '@/server/modules/notifications/paths';

export const STAFF_APPROVALS_PATH = '/staff/approvals';
export const STAFF_PENDING_PRICES_PATH = '/staff/catalog?tab=pending-prices';

export function staffRequestPath(requestId: string, tab: StaffRequestTab = 'summary'): string {
  return requestWorkspaceNotificationPath(requestId, tab);
}

export function customerRequestPath(requestId: string): string {
  return `/portal?request=${encodeURIComponent(requestId)}`;
}

export function staffProjectPath(projectId: string): string {
  return `/staff/projects/${encodeURIComponent(projectId)}`;
}
