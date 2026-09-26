/**
 * En pantallas angostas la lista y el detalle se apilan: al elegir un elemento de la lista, el
 * detalle cambia *debajo* de ella y parece que no pasó nada. Esto lleva al usuario al detalle sólo
 * cuando el diseño está apilado (`stackedQuery` debe coincidir con el punto de corte del CSS).
 */
export function revealWhenStacked(target: HTMLElement | null, stackedQuery: string): void {
  if (!target || typeof window === 'undefined' || !window.matchMedia(stackedQuery).matches) return;
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  window.requestAnimationFrame(() => target.scrollIntoView({ behavior, block: 'start' }));
}
