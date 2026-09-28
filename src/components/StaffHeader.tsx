'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { BadgeCheck, Bell, BookOpen, ChevronDown, ExternalLink, FileText, HardHat, Inbox, LayoutDashboard, LogOut, Menu, ScrollText, Users, X, type LucideIcon } from 'lucide-react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import { usePrivateShellContext } from '@/components/private/PrivateShellContext';
import StaffQuickFind from '@/components/staff/StaffQuickFind';
import { useStaffSession } from '@/components/staff/StaffSessionContext';
import type { PrivateStaffCapabilities } from '@/components/private/navigation';
import { getApiErrorMessage } from '@/lib/api-error-message';

type Section = { href: string; label: string; icon: LucideIcon; capability: keyof PrivateStaffCapabilities };

const SECTIONS: readonly Section[] = [
  { href: '/staff', label: 'Dashboard', icon: LayoutDashboard, capability: 'metricsRead' },
  { href: '/staff/requests', label: 'Solicitudes', icon: Inbox, capability: 'requestsRead' },
  { href: '/staff/quotes', label: 'Cotizaciones', icon: FileText, capability: 'quotesRead' },
  { href: '/staff/projects', label: 'Proyectos', icon: HardHat, capability: 'projectsRead' },
  { href: '/staff/catalog', label: 'Catálogo', icon: BookOpen, capability: 'catalogRead' },
  { href: '/staff/approvals', label: 'Aprobaciones', icon: BadgeCheck, capability: 'approvalsRead' },
  { href: '/staff/notifications', label: 'Notificaciones', icon: Bell, capability: 'notificationsRead' },
  { href: '/staff/audit', label: 'Auditoría', icon: ScrollText, capability: 'auditRead' },
  { href: '/staff/team', label: 'Equipo', icon: Users, capability: 'teamManage' },
];

type Props = Readonly<{
  /** Permite a un panel con cambios sin guardar interceptar la navegación (constructor de cotizaciones). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}>;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toLocaleUpperCase('es-MX');
}

function isCurrent(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return href === '/staff' ? pathname === '/staff' : pathname === href || pathname.startsWith(`${href}/`);
}

export default function StaffHeader({ onNavigate }: Props) {
  const pathname = usePathname();
  const session = useStaffSession();
  const insidePrivateShell = usePrivateShellContext();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const accountMenuId = useId();
  // Densidad según lo que realmente cabe (cada rol ve un número distinto de secciones): 0 completo,
  // 1 sin íconos, 2 sin subtítulos ni etiquetas auxiliares, 3 navegación dentro del menú.
  const [density, setDensity] = useState(0);
  const [measureKey, setMeasureKey] = useState(0);

  const sections = session ? SECTIONS.filter((section) => session.capabilities[section.capability] !== false) : SECTIONS;
  const homeHref = sections[0]?.href ?? '/staff';

  useEffect(() => { setMobileOpen(false); setAccountOpen(false); }, [pathname]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    let lastWidth = header.clientWidth;
    const remeasure = () => { setDensity(0); setMeasureKey((current) => current + 1); };
    const observer = new ResizeObserver(() => {
      if (header.clientWidth === lastWidth) return;
      lastWidth = header.clientWidth;
      remeasure();
    });
    observer.observe(header);
    // Manrope llega después del primer render: al cargar cambia el ancho real de cada enlace.
    void document.fonts?.ready.then(remeasure);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || density >= 3 || window.getComputedStyle(nav).display === 'none') return;
    if (nav.scrollWidth > nav.clientWidth + 1) setDensity((current) => Math.min(current + 1, 3));
  }, [density, measureKey, sections.length]);

  useEffect(() => {
    if (!accountOpen && !mobileOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (accountOpen && !accountRef.current?.contains(target)) setAccountOpen(false);
      if (mobileOpen && !headerRef.current?.contains(target)) setMobileOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (accountOpen) { setAccountOpen(false); accountTriggerRef.current?.focus(); }
      if (mobileOpen) { setMobileOpen(false); mobileToggleRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountOpen, mobileOpen]);

  const logout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutError(null);
    try {
      const response = await fetch('/api/auth/session', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' } });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(getApiErrorMessage(data, 'No fue posible cerrar la sesión.'));
      }
      window.location.assign('/login');
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : 'No fue posible cerrar la sesión.');
      setLogoutBusy(false);
    }
  };

  const navLinks = (variant: 'bar' | 'drawer') => sections.map((section) => {
    const Icon = section.icon;
    const current = isCurrent(pathname, section.href);
    return (
      <Link
        key={section.href}
        href={section.href}
        aria-current={current ? 'page' : undefined}
        className={variant === 'bar' ? 'staff-top-nav__link' : 'staff-mobile-nav__link'}
        onClick={onNavigate ? (event) => onNavigate(event, section.href) : undefined}
      >
        <Icon size={variant === 'bar' ? 16 : 18} strokeWidth={1.9} aria-hidden="true" />
        <span>{section.label}</span>
      </Link>
    );
  });

  const identity = session ? (
    <span className="staff-account__identity">
      <strong>{session.user.displayName}</strong>
      <small>{session.roleLabel}</small>
    </span>
  ) : null;

  return (
    <>
      <header className={`staff-header${density >= 1 ? ' is-compact' : ''}${density >= 2 ? ' is-condensed' : ''}${density >= 3 ? ' is-collapsed' : ''}`} ref={headerRef}>
        <div className="staff-header__inner">
          <WorkspaceBrand className="staff-brand" subtitle="Operaciones" href={homeHref} ariaLabel="OCPOOL, volver al dashboard" onClick={onNavigate ? (event) => onNavigate(event, homeHref) : undefined} />
          <nav className="staff-top-nav" ref={navRef} aria-label="Navegación de operaciones">{navLinks('bar')}</nav>
          <div className="staff-header__tools">
            <StaffQuickFind sections={sections} onNavigate={onNavigate} />
            {session && (
              <div className="staff-account" ref={accountRef}>
                <button
                  ref={accountTriggerRef}
                  className="staff-account__trigger"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  aria-controls={accountOpen ? accountMenuId : undefined}
                  aria-label={`Cuenta de ${session.user.displayName}`}
                  onClick={() => setAccountOpen((current) => !current)}
                >
                  <span className="staff-account__avatar" aria-hidden="true">{initialsOf(session.user.displayName)}</span>
                  {identity}
                  <ChevronDown className="staff-account__chevron" size={15} aria-hidden="true" />
                </button>
                {accountOpen && (
                  <div id={accountMenuId} className="staff-account__panel" role="menu" aria-label="Cuenta">
                    <div className="staff-account__summary">
                      <span className="staff-account__avatar staff-account__avatar--large" aria-hidden="true">{initialsOf(session.user.displayName)}</span>
                      <span><strong>{session.user.displayName}</strong><small>{session.user.email}</small><em>{session.roleLabel}</em></span>
                    </div>
                    <Link role="menuitem" className="staff-account__item" href="/"><ExternalLink size={16} aria-hidden="true" />Ir al sitio público</Link>
                    <button role="menuitem" className="staff-account__item staff-account__item--danger" type="button" disabled={logoutBusy} onClick={() => void logout()}><LogOut size={16} aria-hidden="true" />{logoutBusy ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>
                  </div>
                )}
              </div>
            )}
            <button
              ref={mobileToggleRef}
              className="staff-header__menu-toggle"
              type="button"
              aria-expanded={mobileOpen}
              aria-controls="staff-mobile-nav"
              onClick={() => setMobileOpen((current) => !current)}
            >
              {mobileOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              <span>{mobileOpen ? 'Cerrar' : 'Menú'}</span>
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div id="staff-mobile-nav" className="staff-mobile-nav">
            <nav aria-label="Navegación de operaciones (móvil)">{navLinks('drawer')}</nav>
            {session && (
              <div className="staff-mobile-nav__account">
                <span className="staff-account__avatar" aria-hidden="true">{initialsOf(session.user.displayName)}</span>
                <span className="staff-mobile-nav__identity"><strong>{session.user.displayName}</strong><small>{session.roleLabel} · {session.user.email}</small></span>
                <button className="staff-mobile-nav__logout" type="button" disabled={logoutBusy} onClick={() => void logout()}><LogOut size={16} aria-hidden="true" />{logoutBusy ? 'Cerrando…' : 'Cerrar sesión'}</button>
              </div>
            )}
          </div>
        )}
        {logoutError && <p className="staff-header__error" role="alert">{logoutError}</p>}
      </header>
      {!insidePrivateShell && <span id="contenido" className="staff-skip-target" tabIndex={-1} />}
    </>
  );
}
