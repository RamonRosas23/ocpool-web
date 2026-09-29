'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCheck } from 'lucide-react';
import { PrivateMoneyField, usePrivateToast } from '@/components/private/ui';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import { formatDate } from '@/lib/format-date';
import { parseMoneyInput } from '@/lib/money-input';
import { assignListPrice } from '@/lib/price-list-assign';
import type { PendingPriceGroup } from '@/lib/staff-catalog-types';

export type StaffCatalogPendingPricesTabProps = {
  /** Puede abrir la cotización que espera el precio (`quotes.read`); si no, ve sólo el folio. */
  canOpenQuotes: boolean;
  /** Cuántos conceptos siguen esperando precio (para la insignia de la pestaña). */
  onCountChange: (count: number) => void;
};

function quantityLabel(milliunits: string, unit: string): string {
  const value = Number(milliunits) / 1000;
  return `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(value)} ${unit}`;
}

export default function StaffCatalogPendingPricesTab({ canOpenQuotes, onCountChange }: StaffCatalogPendingPricesTabProps) {
  const { showToast } = usePrivateToast();
  const [groups, setGroups] = useState<PendingPriceGroup[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const response = await fetch('/api/staff/catalog/pending-prices', { credentials: 'include', cache: 'no-store' });
        const data = await readApiResponseOrThrow<{ items: PendingPriceGroup[]; truncated?: boolean }>(response, 'No fue posible cargar los precios por asignar.');
        if (cancelled) return;
        setGroups(data.items);
        setTruncated(Boolean(data.truncated));
        onCountChange(data.items.length);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'No fue posible cargar los precios por asignar.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir la pestaña
  }, []);

  const assign = async (event: FormEvent<HTMLFormElement>, group: PendingPriceGroup) => {
    event.preventDefault();
    if (savingKey) return;
    const minor = parseMoneyInput(amounts[group.key] ?? '');
    if (!minor || BigInt(minor) <= 0n) { setErrors((current) => ({ ...current, [group.key]: 'Escribe un precio mayor a cero.' })); return; }
    setSavingKey(group.key);
    setErrors((current) => ({ ...current, [group.key]: '' }));
    try {
      await assignListPrice(group.priceList, group.item.id, minor);
      const remaining = (groups ?? []).filter((candidate) => candidate.key !== group.key);
      setGroups(remaining);
      onCountChange(remaining.length);
      showToast(`Precio asignado a ${group.item.name} en ${group.priceList.name}. Las propuestas que lo esperan lo aplicarán al abrirse.`);
    } catch (caught) {
      setErrors((current) => ({ ...current, [group.key]: caught instanceof Error ? caught.message : 'No fue posible asignar el precio.' }));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="catalog-pending-prices">
      <p className="catalog-tab-intro">Conceptos que Ventas dejó «por cotizar» en una propuesta porque no tienen precio en su lista. Asígnalo una vez y esas propuestas lo aplican solas al abrirse.</p>
      {error && <p className="staff-error" role="alert">{error}</p>}
      {truncated && <p className="staff-notice" role="status">Hay más propuestas esperando precio de las que se muestran. Asigna estos y vuelve a abrir la pestaña para ver el resto.</p>}
      {loading && <div className="catalog-detail-loading"><span /><span /></div>}
      {!loading && !error && groups && groups.length === 0 && (
        <div className="staff-empty staff-empty--compact catalog-review__empty">
          <span className="staff-empty__mark" aria-hidden="true"><CheckCheck size={20} /></span>
          <h2>Nada por asignar.</h2>
          <p>Cuando alguien deje un concepto «por cotizar» en una propuesta, aparecerá aquí para que le pongas precio en la lista.</p>
        </div>
      )}
      {!loading && groups && groups.length > 0 && (
        <ul className="catalog-pending-price-list">
          {groups.map((group) => (
            <li className="catalog-pending-price" key={group.key}>
              <div className="catalog-pending-price__concept">
                <strong>{group.item.name}</strong>
                <small>{group.item.code} · {group.item.unit}</small>
                <small>Lista: {group.priceList.name} · {group.priceList.currencyCode}</small>
              </div>
              <ul className="catalog-pending-price__requests" aria-label={`Propuestas que esperan ${group.item.name}`}>
                {group.requests.map((request) => (
                  <li key={`${request.quoteRequestId}-${request.since}`}>
                    {canOpenQuotes ? <Link href={`/staff/quotes?request=${request.quoteRequestId}`}>{request.folio}</Link> : <span>{request.folio}</span>}
                    <small>{request.clientName} · {quantityLabel(request.quantityMilliunits, group.item.unit)} · propuesta de {request.requestedBy} · actualizada {formatDate(request.since)}</small>
                  </li>
                ))}
              </ul>
              <form className="catalog-pending-price__form" onSubmit={(event) => void assign(event, group)}>
                <PrivateMoneyField
                  id={`pending-price-${group.key}`}
                  label={`Precio de ${group.item.name} en ${group.priceList.name}`}
                  hideLabel
                  value={amounts[group.key] ?? ''}
                  onValueChange={(value) => { setAmounts((current) => ({ ...current, [group.key]: value })); setErrors((current) => ({ ...current, [group.key]: '' })); }}
                  placeholder="1,250.00"
                  error={errors[group.key] || undefined}
                  disabled={savingKey !== null}
                />
                <button className="staff-button staff-button--copper" type="submit" disabled={savingKey !== null}>{savingKey === group.key ? 'Guardando…' : 'Asignar precio'}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
