'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type CatalogSearchResultItem = {
  id: string;
  code: string;
  name: string;
  unit: string;
  price: { unitPriceMinor: string } | null;
  blocker: 'NO_PRICE_IN_LIST' | null;
};

type ErrorResponse = { error?: { message?: string } };

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(data.error?.message ?? 'No fue posible buscar el catálogo.');
  return data as T;
}

function formatPrice(item: CatalogSearchResultItem, currencyCode: string): string {
  if (!item.price || !/^\d+$/u.test(item.price.unitPriceMinor)) return 'Sin precio';
  const amount = BigInt(item.price.unitPriceMinor);
  return `${currencyCode} ${(amount / 100n).toLocaleString('es-MX')}.${(amount % 100n).toString().padStart(2, '0')}`;
}

export default function CatalogItemSearchCombobox({
  priceListId,
  currencyCode,
  excludeIds,
  disabled = false,
  ariaLabel = 'Agregar concepto a la cotización',
  onSelect,
}: {
  priceListId: string;
  currencyCode: string;
  excludeIds: readonly string[];
  disabled?: boolean;
  ariaLabel?: string;
  onSelect: (item: CatalogSearchResultItem) => void;
}) {
  const listboxId = useId();
  const optionId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CatalogSearchResultItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Primero lo que se puede agregar; los conceptos sin precio en esta lista (no seleccionables) van
  // después bajo su propio encabezado, en vez de mezclarse y enterrar las opciones útiles.
  const visibleItems = items
    .filter((item) => !excludeIds.includes(item.id))
    .map((item, order) => ({ item, order }))
    .sort((a, b) => Number(Boolean(a.item.blocker)) - Number(Boolean(b.item.blocker)) || a.order - b.order)
    .map(({ item }) => item);
  const firstBlockedIndex = visibleItems.findIndex((item) => item.blocker);
  const selectableCount = firstBlockedIndex === -1 ? visibleItems.length : firstBlockedIndex;

  // Si el campo está cerca del borde inferior, se sube para que el desplegable quede a la vista.
  const openAndReveal = () => {
    setOpen(true);
    const input = inputRef.current;
    if (input && input.getBoundingClientRect().bottom > window.innerHeight - 320) input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    if (!priceListId || !open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      // 50 (el máximo de la API) para que, sin escribir, se vean más conceptos con precio.
      const params = new URLSearchParams({ limit: '50' });
      if (term.trim()) params.set('query', term.trim());
      fetch(`/api/staff/catalog/price-lists/${priceListId}/search?${params.toString()}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
        .then((response) => readResponse<{ items: CatalogSearchResultItem[]; nextCursor: string | null }>(response))
        .then((data) => {
          setItems(data.items);
          setHasMore(Boolean(data.nextCursor));
          setActiveIndex(-1);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setError(caught instanceof Error ? caught.message : 'No fue posible buscar el catálogo.');
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [priceListId, open, term]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', closeOnOutsideClick);
    return () => window.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  const choose = (item: CatalogSearchResultItem) => {
    onSelect(item);
    setTerm('');
    setItems([]);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) { openAndReveal(); return; }
      // Las flechas recorren sólo los conceptos que se pueden agregar.
      setActiveIndex((current) => selectableCount ? (current + 1) % selectableCount : -1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => selectableCount ? (current - 1 + selectableCount) % selectableCount : -1);
    } else if (event.key === 'Enter') {
      const activeItem = activeIndex >= 0 ? visibleItems[activeIndex] : undefined;
      if (activeItem) {
        event.preventDefault();
        // Mismo guardado que ya aplica el clic de mouse (línea de abajo, onMouseDown) -- sin esto,
        // un usuario de teclado podía agregar un concepto sin precio en la lista vigente, algo que
        // el mouse ya impedía.
        if (!activeItem.blocker) choose(activeItem);
      }
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); setOpen(false); }
    }
  };

  return (
    <div className="quotes-catalog-search" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${optionId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        className="quotes-catalog-search__input"
        placeholder={priceListId ? 'Buscar concepto por nombre o código…' : 'Selecciona una lista de precios primero'}
        value={term}
        disabled={disabled || !priceListId}
        onChange={(event) => { setTerm(event.target.value); setOpen(true); }}
        onFocus={openAndReveal}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && <ul id={listboxId} role="listbox" aria-label={ariaLabel} className="quotes-catalog-search__listbox">
        {loading && <li className="quotes-catalog-search__status" role="status">Buscando…</li>}
        {!loading && error && <li className="quotes-catalog-search__status quotes-catalog-search__status--error" role="alert">{error}</li>}
        {!loading && !error && visibleItems.length === 0 && <li className="quotes-catalog-search__status">{term.trim() ? 'Sin coincidencias.' : 'Escribe para buscar en todo el catálogo.'}</li>}
        {!loading && !error && visibleItems.map((item, index) => [
          index === firstBlockedIndex && <li key="blocked-heading" role="presentation" className="quotes-catalog-search__group">Sin precio en esta lista{selectableCount === 0 ? ' — asígnale precio en Catálogo para poder agregarlos' : ''}</li>,
          <li
            key={item.id}
            id={`${optionId}-${index}`}
            role="option"
            aria-label={`${item.name} · ${item.unit}`}
            aria-selected={index === activeIndex}
            aria-disabled={Boolean(item.blocker)}
            className={`quotes-catalog-search__option${index === activeIndex ? ' is-active' : ''}${item.blocker ? ' is-blocked' : ''}`}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseDown={(event) => { event.preventDefault(); if (!item.blocker) choose(item); }}
          >
            <span className="quotes-catalog-search__option-name">{item.name} · {item.unit}</span>
            <span className="quotes-catalog-search__option-code">{item.code}</span>
            <span className="quotes-catalog-search__option-price">{formatPrice(item, currencyCode)}</span>
          </li>,
        ])}
        {!loading && !error && hasMore && <li className="quotes-catalog-search__status">Hay más conceptos: escribe parte del nombre o la clave para acotar.</li>}
      </ul>}
    </div>
  );
}
