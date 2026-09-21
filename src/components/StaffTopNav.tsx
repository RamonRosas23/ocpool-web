'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MouseEvent } from 'react';

const SECTIONS = [
  { href: '/staff', label: 'Dashboard' },
  { href: '/staff/requests', label: 'Solicitudes' },
  { href: '/staff/quotes', label: 'Cotizaciones' },
  { href: '/staff/catalog', label: 'Catálogo' },
  { href: '/staff/approvals', label: 'Aprobaciones' },
  { href: '/staff/notifications', label: 'Notificaciones' },
  { href: '/staff/audit', label: 'Auditoría' },
] as const;

type Props = Readonly<{
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}>;

export default function StaffTopNav({ onNavigate }: Props) {
  const pathname = usePathname();
  return <nav className="staff-top-nav" aria-label="Navegación de operaciones">
    {SECTIONS.map((section) => {
      const isCurrent = section.href === '/staff' ? pathname === '/staff' : pathname?.startsWith(section.href);
      return <Link key={section.href} href={section.href} aria-current={isCurrent ? 'page' : undefined} onClick={onNavigate ? (event) => onNavigate(event, section.href) : undefined}>{section.label}</Link>;
    })}
  </nav>;
}
