'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react';
import { ArrowRight, Clock, FileSearch, Search, type LucideIcon } from 'lucide-react';
import { PrivateDialog } from '@/components/private/ui';
import { QUOTE_REQUEST_STATUS_LABELS } from '@/lib/request-workspace-query';

export type QuickFindSection = { href: string; label: string; icon: LucideIcon };

type RequestHit = {
  id: string;
  folio: string;
  status: string;
  client: { displayName: string };
  contact?: { email: string } | null;
  detail: { projectType: string; location: string } | null;
};

type RecentHit = { id: string; folio: string; client: string };

type Option =
  | { kind: 'section'; key: string; href: string; label: string; hint: string; icon: LucideIcon }
  | { kind: 'request'; key: string; href: string; label: string; hint: string; meta: string; recent: RecentHit };

const RECENT_KEY = 'ocpool.staff.quickfind.recent';
const STATUS_LABELS: Record<string, string> = QUOTE_REQUEST_STATUS_LABELS;

function readRecents(): RecentHit[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is RecentHit => Boolean(item && typeof item.id === 'string' && typeof item.folio === 'string')).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function rememberRecent(hit: RecentHit) {
  try {
    const next = [hit, ...readRecents().filter((item) => item.id !== hit.id)].slice(0, 5);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Almacenamiento no disponible (modo privado): el buscador sigue funcionando sin recientes.
  }
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-MX');
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

type Props = Readonly<{
  sections: readonly QuickFindSection[];
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}>;

/**
 * Buscador global del espacio de staff (Ctrl/⌘+K, o "/" fuera de un campo de texto): salta a un
 * expediente por folio, cliente o correo, o a cualquier sección, sin pasar por la bandeja. Los
 * resultados son enlaces reales, así que respetan la guarda de cambios sin guardar del constructor
 * igual que la navegación del header.
 */
export default function StaffQuickFind({ sections, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RequestHit[]>([]);
  const [recents, setRecents] = useState<RecentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const titleId = `${baseId}-title`;

  const openFinder = useCallback(() => {
    setQuery('');
    setHits([]);
    setSearchError(null);
    setActiveIndex(0);
    setRecents(readRecents());
    setOpen(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) return;
        openFinder();
        return;
      }
      if (event.key === '/' && !open && !isEditableTarget(event.target) && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        event.preventDefault();
        openFinder();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, openFinder]);

  const trimmed = query.trim();
  useEffect(() => {
    if (!open || trimmed.length < 2) { setHits([]); setSearching(false); setSearchError(null); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ query: trimmed, page: '1', pageSize: '8' });
        const response = await fetch(`/api/staff/quote-requests?${params.toString()}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('No fue posible buscar expedientes.');
        const data = await response.json() as { items?: RequestHit[] };
        setHits(data.items ?? []);
        setSearchError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setHits([]);
        setSearchError('No fue posible buscar expedientes. Intenta de nuevo.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, trimmed]);

  const options = useMemo<Option[]>(() => {
    const needle = normalize(trimmed);
    const sectionOptions: Option[] = sections
      .filter((section) => !needle || normalize(section.label).includes(needle))
      .map((section) => ({ kind: 'section', key: `section:${section.href}`, href: section.href, label: section.label, hint: 'Ir a la sección', icon: section.icon }));
    const requestOptions: Option[] = trimmed.length >= 2
      ? hits.map((hit) => ({
        kind: 'request',
        key: `request:${hit.id}`,
        href: `/staff/requests?request=${encodeURIComponent(hit.id)}`,
        label: hit.folio,
        hint: hit.client.displayName,
        meta: [STATUS_LABELS[hit.status] ?? hit.status, hit.detail?.projectType, hit.detail?.location].filter(Boolean).join(' · '),
        recent: { id: hit.id, folio: hit.folio, client: hit.client.displayName },
      }))
      : recents.map((recent) => ({ kind: 'request', key: `recent:${recent.id}`, href: `/staff/requests?request=${encodeURIComponent(recent.id)}`, label: recent.folio, hint: recent.client, meta: 'Abierto recientemente', recent }));
    return [...requestOptions, ...sectionOptions];
  }, [hits, recents, sections, trimmed]);

  useEffect(() => { setActiveIndex(0); }, [trimmed, hits.length]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const activate = (index: number) => {
    const element = listRef.current?.querySelector<HTMLAnchorElement>(`[data-index="${index}"]`);
    element?.click();
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, options.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); if (options[activeIndex]) activate(activeIndex); }
  };

  const handleOptionClick = (option: Option) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (option.kind === 'request') rememberRecent(option.recent);
    onNavigate?.(event, option.href);
    setOpen(false);
  };

  const requestCount = options.filter((option) => option.kind === 'request').length;
  const statusText = trimmed.length >= 2
    ? searching ? 'Buscando expedientes…' : searchError ?? (hits.length === 0 ? `Sin expedientes para «${trimmed}».` : `${hits.length} expediente${hits.length === 1 ? '' : 's'}`)
    : recents.length ? 'Recientes y secciones' : 'Escribe al menos 2 caracteres para buscar expedientes';

  return (
    <>
      <button className="staff-quickfind__trigger" type="button" onClick={openFinder} aria-label="Buscar expediente o sección (Ctrl + K)" aria-haspopup="dialog">
        <Search size={16} aria-hidden="true" />
        <span className="staff-quickfind__trigger-label">Buscar</span>
        <kbd aria-hidden="true">Ctrl K</kbd>
      </button>
      <PrivateDialog open={open} onClose={() => setOpen(false)} labelledBy={titleId} initialFocusRef={inputRef} className="staff-quickfind" overlayClassName="staff-quickfind__overlay">
        <h2 id={titleId} className="sr-only">Buscar expediente o sección</h2>
        <div className="staff-quickfind__field">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-label="Buscar por folio, cliente, correo o sección"
            placeholder="Busca por folio, cliente, correo o sección…"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <kbd aria-hidden="true">Esc</kbd>
        </div>
        <p className="staff-quickfind__status" aria-live="polite">{statusText}</p>
        <ul ref={listRef} id={listboxId} className="staff-quickfind__list" role="listbox" aria-label="Resultados">
          {options.map((option, index) => {
            const Icon = option.kind === 'section' ? option.icon : option.key.startsWith('recent:') ? Clock : FileSearch;
            const groupStart = index === 0 || options[index - 1].kind !== option.kind || (option.kind === 'request' && options[index - 1].key.startsWith('recent:') !== option.key.startsWith('recent:'));
            return (
              <li key={option.key} role="presentation">
                {groupStart && <span className="staff-quickfind__group" aria-hidden="true">{option.kind === 'section' ? 'Secciones' : option.key.startsWith('recent:') ? 'Recientes' : 'Expedientes'}</span>}
                <Link
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  tabIndex={-1}
                  data-index={index}
                  className={`staff-quickfind__option${index === activeIndex ? ' is-active' : ''}`}
                  href={option.href}
                  onMouseMove={() => { if (index !== activeIndex) setActiveIndex(index); }}
                  onClick={handleOptionClick(option)}
                >
                  <span className="staff-quickfind__icon" aria-hidden="true"><Icon size={17} strokeWidth={1.9} /></span>
                  <span className="staff-quickfind__text">
                    <strong>{option.label}</strong>
                    <small>{option.kind === 'request' ? `${option.hint}${option.meta ? ` · ${option.meta}` : ''}` : option.hint}</small>
                  </span>
                  <ArrowRight className="staff-quickfind__go" size={16} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="staff-quickfind__footer" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> moverte</span><span><kbd>Enter</kbd> abrir</span><span>{requestCount > 0 ? 'Los expedientes abren en Solicitudes' : 'Tip: presiona / desde cualquier pantalla'}</span></p>
      </PrivateDialog>
    </>
  );
}
