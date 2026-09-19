'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import { pathMatches, privateShellTrail, type PrivateNavigationItem } from '@/components/private/navigation';
import { getApiErrorMessage } from '@/lib/api-error-message';
import type { PrivateShellSurface } from '@/server/private-shell';

type PrivateShellChromeProps = {
  surface: PrivateShellSurface;
  user: { displayName: string; email: string };
  roleLabel: string;
  navigation: readonly PrivateNavigationItem[];
};

export default function PrivateShellChrome({ surface, user, roleLabel, navigation }: PrivateShellChromeProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const brandClass = surface === 'staff' ? 'staff-brand' : 'client-brand';
  const brandHref = surface === 'staff' ? '/staff' : '/portal';
  const brandAriaLabel = surface === 'staff' ? 'OCPOOL, volver al centro de trabajo' : 'OCPOOL, volver a mis expedientes';
  const logoutTarget = surface === 'staff' ? '/login' : '/portal/access';
  const trail = privateShellTrail(pathname, surface, navigation);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
      window.location.assign(logoutTarget);
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : 'No fue posible cerrar la sesión.');
      setLogoutBusy(false);
    }
  };

  return (
    <header className="private-shell__header">
      <div className="private-shell__topline">
        <WorkspaceBrand className={brandClass} subtitle={surface === 'staff' ? 'Operaciones comerciales' : 'Portal de cliente'} href={brandHref} ariaLabel={brandAriaLabel} />
        <button className="private-shell__menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="private-shell-navigation" onClick={() => setMenuOpen((current) => !current)}>
          <span aria-hidden="true">{menuOpen ? <X size={16} /> : <Menu size={16} />}</span>{menuOpen ? 'Cerrar' : 'Menú'}
        </button>
      </div>
      {trail && <nav className="private-shell__trail" aria-label="Ruta actual"><Link href={trail.returnHref}>← {trail.returnLabel}</Link><span aria-hidden="true">/</span><span aria-current="page">{trail.currentLabel}</span></nav>}
      <div className={`private-shell__body${menuOpen ? ' is-open' : ''}`}>
        <nav id="private-shell-navigation" className="private-shell__navigation" aria-label={surface === 'staff' ? 'Navegación de operaciones' : 'Navegación del portal'}>
          {navigation.map((item) => {
            const current = pathMatches(pathname, item.href);
            return <Link href={item.href} aria-current={current ? 'page' : undefined} key={item.key} onClick={() => setMenuOpen(false)}>{item.label}</Link>;
          })}
        </nav>
        <div className="private-shell__account">
          <div className="private-shell__identity"><strong>{user.displayName}</strong><span>{roleLabel}</span><small>{user.email}</small></div>
          <button className="private-button private-button--quiet private-shell__logout" type="button" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? 'Cerrando…' : 'Cerrar sesión'}</button>
        </div>
      </div>
      {logoutError && <p className="private-shell__logout-error" role="alert">{logoutError} Puedes reintentar sin perder tu trabajo.</p>}
    </header>
  );
}
