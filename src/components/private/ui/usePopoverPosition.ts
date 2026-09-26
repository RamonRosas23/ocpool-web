'use client';

import { useCallback, useEffect, useState, type CSSProperties, type RefObject } from 'react';

export type PopoverPositionOptions = {
  gap?: number;
  minHeight?: number;
  matchTriggerWidth?: boolean;
  width?: number;
};

// Cualquier popover que viva dentro de un PrivateDialog está anidado en un contenedor con
// `overflow-y: auto` (el propio diálogo, para permitir formularios largos) -- si el popover se
// posiciona con `position: absolute` dentro de esa jerarquía, la parte que exceda el alto visible
// del diálogo queda recortada/inaccesible en vez de flotar por encima de todo. La solución no es
// tocar el overflow del diálogo (rompería su propio scroll), sino portar el popover fuera de esa
// jerarquía (hasta `.private-ui-scope`, el mismo destino que ya usa `PrivateSelect` con Radix) y
// calcular su posición en coordenadas de viewport con `position: fixed`, incluyendo voltear hacia
// arriba cuando no cabe abajo y recortar el ancho horizontal para no salirse de la pantalla.
export function usePopoverPosition(triggerRef: RefObject<HTMLElement | null>, open: boolean, options: PopoverPositionOptions = {}) {
  const { gap = 7, minHeight = 220, matchTriggerWidth = false, width } = options;
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    setPortalContainer(triggerRef.current?.closest<HTMLElement>('.private-ui-scope') ?? null);
  }, [triggerRef]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const resolvedWidth = matchTriggerWidth ? rect.width : width;
    let left = rect.left;
    if (resolvedWidth && left + resolvedWidth + margin > window.innerWidth) left = Math.max(margin, window.innerWidth - resolvedWidth - margin);
    const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const next: CSSProperties = { position: 'fixed', left, ...(resolvedWidth ? { width: resolvedWidth } : {}) };
    if (spaceBelow >= minHeight || spaceBelow >= spaceAbove) {
      next.top = rect.bottom + gap;
      next.maxHeight = Math.max(minHeight, spaceBelow);
    } else {
      next.bottom = window.innerHeight - rect.top + gap;
      next.maxHeight = Math.max(minHeight, spaceAbove);
    }
    setStyle(next);
  }, [triggerRef, gap, minHeight, matchTriggerWidth, width]);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  return { portalContainer, style };
}
