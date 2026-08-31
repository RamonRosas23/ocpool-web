'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DirectionalIcon } from '@/components/DirectionalIcon';

const links = [
  { href: '#inicio', label: 'Inicio' },
  { href: '#proyectos', label: 'Proyectos' },
  { href: '#servicios', label: 'Servicios' },
  { href: '#nosotros', label: 'Nosotros' },
];

export default function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement | null>(null);
  const navigationRef = useRef<HTMLElement | null>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => menuToggleRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (navigationRef.current?.contains(target) || menuToggleRef.current?.contains(target)) return;
      closeMenu(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeMenu, isMenuOpen]);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="brand" href="#inicio" onClick={() => closeMenu()} aria-label="OCPOOL, inicio">
          <Image src="/brand/ocpool-logo.png" alt="OCPOOL" width={94} height={71} className="brand__logo" />
          <span className="brand__descriptor">Diseño / construcción<br />de espacios acuáticos</span>
        </a>

        <nav ref={navigationRef} id="primary-navigation" className={`site-nav ${isMenuOpen ? 'site-nav--open' : ''}`} aria-label="Navegación principal">
          <div className="site-nav__links">
            {links.map((link) => (
              <a key={link.href} href={link.href} onClick={() => closeMenu()}>
                {link.label}
              </a>
            ))}
          </div>
          <a className="button button--small button--outline" href="#contacto" onClick={() => closeMenu()}>
            Cotizar <DirectionalIcon />
          </a>
        </nav>

        <button
          type="button"
          className="menu-toggle"
          ref={menuToggleRef}
          aria-expanded={isMenuOpen}
          aria-controls="primary-navigation"
          aria-label={isMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
          onClick={() => {
            if (isMenuOpen) closeMenu();
            else setIsMenuOpen(true);
          }}
        >
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
