export type MessagePage<M extends { id: string }, C> = { conversation: C; items: M[]; nextCursor: string | null };

/**
 * La API de mensajes pagina en orden cronológico ascendente y su cursor avanza hacia los más
 * NUEVOS. Pedir sólo la primera página mostraba los mensajes más viejos y escondía los recientes
 * (lo que importa) detrás de un botón. Esto sigue el cursor hasta el final (con tope de páginas)
 * para que el hilo abra siempre en su estado actual; si aún quedara más, `nextCursor` lo indica.
 */
export async function loadThroughLatest<M extends { id: string }, C>(
  loadPage: (cursor?: string) => Promise<MessagePage<M, C>>,
  maxPages = 10,
): Promise<MessagePage<M, C>> {
  const first = await loadPage();
  let items = first.items;
  let conversation = first.conversation;
  let nextCursor = first.nextCursor;
  for (let page = 1; nextCursor && page < maxPages; page += 1) {
    const next = await loadPage(nextCursor);
    const known = new Set(items.map((item) => item.id));
    items = [...items, ...next.items.filter((item) => !known.has(item.id))];
    conversation = next.conversation;
    nextCursor = next.nextCursor;
  }
  return { conversation, items, nextCursor };
}
