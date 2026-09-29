'use client';

import Link from 'next/link';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { nextRovingTabIndex } from './a11y';

export type PrivateTabItem = {
  key: string;
  label: string;
  href: string;
  badge?: number;
};

export type PrivateTabsProps = {
  tabs: PrivateTabItem[];
  activeKey: string;
  ariaLabel: string;
  tabpanelId: string;
  className?: string;
};

function handleTabKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
  const tabLinks = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? []);
  const currentIndex = tabLinks.indexOf(event.currentTarget);
  const nextIndex = nextRovingTabIndex(event.key, currentIndex, tabLinks.length);
  if (nextIndex === null) return;
  event.preventDefault();
  tabLinks[nextIndex]?.focus();
}

export function PrivateTabs({ tabs, activeKey, ariaLabel, tabpanelId, className }: PrivateTabsProps) {
  const navRef = useRef<HTMLElement>(null);
  // En pantallas angostas las pestañas se desplazan: la activa (p. ej. al llegar por un enlace directo del
  // tablero) debe quedar a la vista, sin mover la página en vertical.
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeKey]);

  return (
    <nav ref={navRef} className={['private-tabs', className].filter(Boolean).join(' ')} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          role="tab"
          tabIndex={activeKey === tab.key ? 0 : -1}
          aria-selected={activeKey === tab.key}
          aria-controls={tabpanelId}
          className={['private-tabs__tab', activeKey === tab.key ? 'is-active' : ''].filter(Boolean).join(' ')}
          href={tab.href}
          onKeyDown={handleTabKeyDown}
        >
          {tab.label}
          {typeof tab.badge === 'number' && tab.badge > 0 && <span className="private-tabs__badge">{tab.badge}</span>}
        </Link>
      ))}
    </nav>
  );
}
