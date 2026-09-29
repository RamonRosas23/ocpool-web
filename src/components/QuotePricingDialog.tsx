'use client';

import { useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { PrivateDialog, PrivateMoneyField } from '@/components/private/ui';
import { parseMoneyInput } from '@/lib/money-input';

/**
 * Qué hacer con un concepto que no tiene precio en la lista de la cotización, sin salir del constructor:
 * - QUOTE: precio manual sólo para esta cotización (con motivo; requiere `quotes.edit_prices`).
 * - LIST: además guardarlo en la lista de precios (requiere `prices.manage`).
 * - PENDING: agregarlo "por cotizar", sin precio; la propuesta no pasa a revisión hasta que lo tenga.
 */
export type PricingScope = 'QUOTE' | 'LIST' | 'PENDING';
export type PricingSubmission = { scope: PricingScope; minor: string | null; reason: string };

type PricingDialogItem = { code: string; name: string; unit: string };

type QuotePricingDialogProps = {
  item: PricingDialogItem;
  priceListName: string;
  currencyCode: string;
  /** `quotes.edit_prices`: puede fijar un precio manual sólo para esta cotización. */
  canSetQuotePrice: boolean;
  /** `prices.manage` (con la lista ya cargada): puede guardar el precio también en la lista. */
  canSaveToList: boolean;
  /** Falso si la línea ya está "por cotizar": dejarla así no sería una opción. */
  canLeavePending: boolean;
  /** La línea ya está en la propuesta (se le aplica el precio) en vez de agregarse una nueva. */
  forExistingLine: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (submission: PricingSubmission) => void;
  onClose: () => void;
};

const MIN_REASON_LENGTH = 3;

export default function QuotePricingDialog({ item, priceListName, currencyCode, canSetQuotePrice, canSaveToList, canLeavePending, forExistingLine, busy, error, onSubmit, onClose }: QuotePricingDialogProps) {
  const canPrice = canSetQuotePrice || canSaveToList;
  const amountRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<PricingScope>(canSetQuotePrice ? 'QUOTE' : canSaveToList ? 'LIST' : 'PENDING');
  const [amountInput, setAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (scope === 'PENDING') { onSubmit({ scope, minor: null, reason: '' }); return; }
    const minor = parseMoneyInput(amountInput);
    if (!minor || BigInt(minor) <= 0n) { setLocalError('Escribe un precio mayor a cero.'); return; }
    const trimmedReason = reason.trim();
    if (scope === 'QUOTE' && trimmedReason.length < MIN_REASON_LENGTH) { setLocalError(`Escribe el motivo del precio manual (mínimo ${MIN_REASON_LENGTH} caracteres).`); return; }
    setLocalError(null);
    onSubmit({ scope, minor, reason: scope === 'QUOTE' ? trimmedReason : '' });
  };

  const submitLabel = busy
    ? 'Guardando…'
    : scope === 'PENDING'
      ? 'Agregar como por cotizar'
      : scope === 'LIST'
        ? (forExistingLine ? 'Guardar en la lista y aplicar' : 'Guardar en la lista y agregar')
        : (forExistingLine ? 'Aplicar a la cotización' : 'Agregar a la cotización');
  const shownError = localError ?? error;

  return (
    <PrivateDialog open onClose={() => { if (!busy) onClose(); }} initialFocusRef={amountRef} labelledBy="quotes-pricing-dialog-title" className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay">
      <div className="quotes-preflight-dialog__head">
        <h3 id="quotes-pricing-dialog-title">{canPrice ? 'Definir precio' : 'Concepto sin precio'}</h3>
        <button className="staff-dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
      </div>
      <form className="catalog-form quotes-pricing" onSubmit={submit}>
        <p className="quotes-pricing__concept"><strong>{item.name}</strong><small>{item.code} · {item.unit}</small></p>
        <p className="quotes-pricing__context">
          Este concepto no tiene precio en <strong>{priceListName}</strong>.{' '}
          {canPrice ? 'Defínelo para agregarlo a la propuesta sin salir de aquí.' : 'Tu perfil no puede fijar precios.'}
        </p>
        {canPrice && scope !== 'PENDING' && (
          <PrivateMoneyField id="quotes-pricing-amount" inputRef={amountRef} label={`Precio por ${item.unit} (${currencyCode})`} required value={amountInput} onValueChange={(value) => { setAmountInput(value); setLocalError(null); }} placeholder="1,250.00" />
        )}
        {canPrice ? (
          <fieldset className="quotes-pricing__scope">
            <legend>¿Qué quieres hacer?</legend>
            {canSetQuotePrice && (
              <label className={scope === 'QUOTE' ? 'is-selected' : ''}>
                <input type="radio" name="quotes-pricing-scope" checked={scope === 'QUOTE'} onChange={() => { setScope('QUOTE'); setLocalError(null); }} />
                <span><strong>Solo en esta cotización</strong><small>La lista de precios no cambia. La línea queda marcada como precio manual.</small></span>
              </label>
            )}
            {canSaveToList && (
              <label className={scope === 'LIST' ? 'is-selected' : ''}>
                <input type="radio" name="quotes-pricing-scope" checked={scope === 'LIST'} onChange={() => { setScope('LIST'); setLocalError(null); }} />
                <span><strong>Guardar también en la lista</strong><small>Se usará en futuras cotizaciones con {priceListName}. Las cotizaciones ya enviadas no cambian.</small></span>
              </label>
            )}
            {canLeavePending && (
              <label className={scope === 'PENDING' ? 'is-selected' : ''}>
                <input type="radio" name="quotes-pricing-scope" checked={scope === 'PENDING'} onChange={() => { setScope('PENDING'); setLocalError(null); }} />
                <span><strong>Todavía no lo sé: dejarlo por cotizar</strong><small>Se agrega sin precio y no suma al total. La propuesta no pasará a revisión hasta que tenga uno; quien administra los precios lo verá en Catálogo → Precios por asignar.</small></span>
              </label>
            )}
          </fieldset>
        ) : (
          <p className="quotes-pricing__note">
            Puedes agregarlo como <strong>por cotizar</strong>: entra sin precio y no suma al total. Quien administra los precios lo verá en Catálogo → Precios por asignar y, cuando lo asigne, el precio se aplicará solo a esta propuesta. Mientras tanto no podrá pasar a revisión.
          </p>
        )}
        {scope === 'QUOTE' && (
          <label>
            <span>Motivo del precio manual</span>
            <input required minLength={MIN_REASON_LENGTH} maxLength={300} value={reason} onChange={(event) => { setReason(event.target.value); setLocalError(null); }} placeholder="Por ejemplo: cotizado por el proveedor" />
          </label>
        )}
        {shownError && <p className="quotes-pricing__error" role="alert">{shownError}</p>}
        <button className="staff-button staff-button--copper" type="submit" disabled={busy}>{submitLabel}</button>
      </form>
    </PrivateDialog>
  );
}
