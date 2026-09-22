'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { nextRovingTabIndex } from './a11y';
import { PrivateButton, type PrivateButtonProps } from './PrivateControls';

export type PrivateMenuItem = { key: string; label: string; description?: string; href?: string; onActivate?: () => void };

export type PrivateMenuProps = {
  triggerLabel: string;
  items: readonly PrivateMenuItem[];
  triggerVariant?: PrivateButtonProps['variant'];
  panelId?: string;
  panelLabel?: string;
  className?: string;
};

export function PrivateMenu({ triggerLabel, items, triggerVariant = 'quiet', panelId = 'private-menu-panel', panelLabel, className }: PrivateMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('pointerdown', closeOnPointerDown);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('pointerdown', closeOnPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, [open]);

  // UX audit fix: el menú sólo se cerraba con Escape o un clic fuera -- un usuario de sólo teclado
  // que tabulaba más allá del último elemento (o fuera del menú en general) movía el foco a otra
  // parte de la página mientras el panel seguía visiblemente abierto, sin ninguna forma de
  // cerrarlo salvo Escape o un clic. `onBlur` en el panel cierra el menú en cuanto el foco sale de
  // `menuRef` (que también incluye el botón disparador, así que tabular hacia/desde éste no cierra
  // el menú de más).
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (menuItems.length === 0) return;
    const currentIndex = Math.max(menuItems.indexOf(document.activeElement as HTMLElement), 0);
    const nextIndex = nextRovingTabIndex(event.key, currentIndex, menuItems.length);
    if (nextIndex === null) return;
    event.preventDefault();
    menuItems[nextIndex]?.focus();
  };

  return (
    <div className={['private-menu', className].filter(Boolean).join(' ')} ref={menuRef}>
      <PrivateButton ref={triggerRef} type="button" variant={triggerVariant} aria-haspopup="menu" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>{triggerLabel}</PrivateButton>
      {open && <div id={panelId} className="private-menu__panel" role="menu" aria-label={panelLabel ?? triggerLabel} onKeyDown={handleMenuKeyDown} onBlur={(event) => { if (!menuRef.current?.contains(event.relatedTarget as Node)) setOpen(false); }}>
        {items.map((item) => item.href
          ? <Link key={item.key} role="menuitem" href={item.href} onClick={() => setOpen(false)}><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</Link>
          : <button key={item.key} type="button" role="menuitem" onClick={() => { setOpen(false); item.onActivate?.(); }}><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</button>)}
      </div>}
    </div>
  );
}
