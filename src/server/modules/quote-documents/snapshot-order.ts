type Positioned = Readonly<{ id: string; position: number }>;

/** Secciones en el orden en que el equipo las acomodó; el id desempata para no depender de la base. */
export function orderQuoteSections<T extends Positioned>(sections: readonly T[]): T[] {
  return [...sections].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * Partidas en el orden de su sección y luego en el suyo propio; las sueltas (o de una sección que ya
 * no existe) al final. Antes se ordenaban por id (UUID), es decir, al azar.
 */
export function orderQuoteLines<T extends Positioned & Readonly<{ sectionId: string | null }>>(lines: readonly T[], orderedSections: readonly Readonly<{ id: string }>[]): T[] {
  const rank = new Map(orderedSections.map((section, index) => [section.id, index]));
  const sectionRank = (line: T) => (line.sectionId !== null ? rank.get(line.sectionId) : undefined) ?? Number.MAX_SAFE_INTEGER;
  return [...lines].sort((a, b) => sectionRank(a) - sectionRank(b) || a.position - b.position || a.id.localeCompare(b.id));
}
