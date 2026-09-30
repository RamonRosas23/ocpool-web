type ThreadItem = Readonly<{ id: string; createdAt: string }>;
export type CustomerRead = Readonly<{ through: string; at: string }>;

/** Une los mensajes nuevos sin duplicarlos y conserva el orden cronológico del hilo. */
export function mergeThread<M extends ThreadItem>(current: readonly M[], incoming: readonly M[]): Readonly<{ items: M[]; added: string[] }> {
  const known = new Set(current.map((item) => item.id));
  const added = incoming.filter((item) => !known.has(item.id));
  if (added.length === 0) return { items: [...current], added: [] };
  const items = [...current, ...added].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
  return { items, added: added.map((item) => item.id) };
}

/** Devuelve la hora de lectura si el cliente ya leyó el último mensaje enviado por el equipo. */
export function seenAt<M extends ThreadItem>(messages: readonly M[], customerRead: CustomerRead | null, isTeam: (message: M) => boolean): string | null {
  const last = messages[messages.length - 1];
  if (!last || !customerRead || !isTeam(last)) return null;
  return Date.parse(customerRead.through) >= Date.parse(last.createdAt) ? customerRead.at : null;
}
