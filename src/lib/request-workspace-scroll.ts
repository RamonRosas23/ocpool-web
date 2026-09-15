export function requestWorkspaceScrollStorageKey(serializedQuery: string): string {
  return `ocpool:request-workspace-scroll:${serializedQuery || 'default'}`;
}
