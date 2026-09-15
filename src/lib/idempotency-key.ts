export function generateIdempotencyId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateIdempotencyKey(
  currentKey: string | null,
  prefix: string,
  generateId: () => string = generateIdempotencyId,
): string {
  return currentKey ?? `${prefix}-${generateId()}`;
}
