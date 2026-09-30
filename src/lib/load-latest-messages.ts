export type MessagePage<M extends { id: string }, C> = { conversation: C; items: M[]; nextCursor: string | null };

/**
 * La API de mensajes pagina en orden cronológico ascendente y su cursor avanza hacia los más
 * NUEVOS. Pedir sólo la primera página mostraba los mensajes más viejos y escondía los recientes
 * (lo que importa) detrás de un botón. Esto sigue el cursor hasta el final (con tope de páginas)
 * para que el hilo abra siempre en su estado actual; si aún quedara más, `nextCursor` lo indica.
 * Los demás campos (`latestCursor`, `customerRead`) son los de la última página.
 */
export async function loadThroughLatest<M extends { id: string }, P extends MessagePage<M, unknown>>(
  loadPage: (cursor?: string) => Promise<P>,
  maxPages = 10,
): Promise<P> {
  let last = await loadPage();
  let items = last.items;
  for (let page = 1; last.nextCursor && page < maxPages; page += 1) {
    const next = await loadPage(last.nextCursor);
    const known = new Set(items.map((item) => item.id));
    items = [...items, ...next.items.filter((item) => !known.has(item.id))];
    last = next;
  }
  return { ...last, items };
}
