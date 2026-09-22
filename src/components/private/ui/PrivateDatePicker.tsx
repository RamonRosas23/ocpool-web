'use client';

import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { es } from 'react-day-picker/locale';
import { privateFieldA11y } from './a11y';
import PrivateField, { type PrivateFieldChromeProps } from './PrivateField';

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])'));
}

export type PrivateDatePickerProps = Omit<PrivateFieldChromeProps, 'children'> & {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
};

function formatValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// `new Date('2026-02-30T12:00:00')` no produce `Invalid Date` -- rueda en silencio al 2 de marzo.
// Sin el chequeo de ida y vuelta (`formatValue(date) === value`), un calendario inexistente escrito
// a mano (p.ej. una fecha límite de "Vigencia hasta" en StaffQuotesPanel) se aceptaba como si fuera
// un día real y distinto al que la persona tecleó, sin ningún aviso.
function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return formatValue(date) === value ? date : undefined;
}

function isMalformedCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && parseDate(value) === undefined;
}

export function PrivateDatePicker({ id, label, description, error, required, hideLabel, className, value, onValueChange, placeholder = 'Selecciona una fecha', disabled = false, min, max }: PrivateDatePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selected = parseDate(value);
  const minDate = parseDate(min ?? '');
  const maxDate = parseDate(max ?? '');
  // Sólo se agrega cuando el consumidor no trae ya su propio `error` -- una validación externa más
  // específica (p.ej. una fecha fuera de rango de negocio) siempre tiene precedencia sobre este
  // aviso genérico de "esta fecha no existe en el calendario".
  const effectiveError = error ?? (isMalformedCalendarDate(value) ? 'Esa fecha no existe en el calendario.' : undefined);
  const a11y = privateFieldA11y(id, Boolean(description), Boolean(effectiveError), required);

  useEffect(() => {
    if (!open) return undefined;
    const firstFocusable = popoverRef.current?.querySelector<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])');
    firstFocusable?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); return; }
      // UX audit fix: este popover ya es `role="dialog"` pero nunca atrapaba Tab -- a diferencia de
      // todo `PrivateDialog` de la app, un usuario de teclado que tabulaba fuera del calendario
      // (p.ej. más allá del selector de año en `captionLayout="dropdown"`) movía el foco a otra
      // parte de la página mientras el calendario seguía visiblemente abierto. Mismo patrón de
      // "sólo intervenir en los bordes" que ya usa `PrivateDialog.tsx`.
      if (event.key !== 'Tab') return;
      const container = popoverRef.current;
      if (!container) return;
      const elements = focusableElements(container);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <PrivateField id={id} label={label} description={description} error={effectiveError} required={required} hideLabel={hideLabel}>
      <div className={joinClasses('private-date-field', className)} ref={rootRef}>
        <div className="private-date-field__control">
          {/* UX audit fix: `required` sólo alimentaba `aria-required` -- el mismo hueco ya
              encontrado y corregido en PrivateTextField/PrivateTextArea/PrivateMoneyField, aquí
              en el cuarto y último campo del kit que lo tenía. */}
          <input id={id} className="private-control private-date-field__input" type="text" inputMode="numeric" autoComplete="off" value={value} placeholder={placeholder} disabled={disabled} required={required} aria-describedby={a11y.describedBy} aria-invalid={a11y.invalid} aria-labelledby={a11y.labelId} aria-required={a11y.required} onChange={(event) => onValueChange(event.target.value)} />
          <button ref={triggerRef} className="private-date-field__trigger" type="button" aria-label={`Abrir calendario: ${label}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
            <span className="private-date-field__icon" aria-hidden="true">▣</span>
          </button>
        </div>
        {open && <div ref={popoverRef} className="private-date-field__popover" role="dialog" aria-label={label}>
          <DayPicker
            mode="single"
            locale={es}
            weekStartsOn={1}
            selected={selected}
            onSelect={(date) => {
              if (date) {
                onValueChange(formatValue(date));
                setOpen(false);
                triggerRef.current?.focus();
              }
            }}
            disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
            showOutsideDays
            captionLayout="dropdown"
            fromYear={minDate?.getFullYear() ?? new Date().getFullYear() - 10}
            toYear={maxDate?.getFullYear() ?? new Date().getFullYear() + 10}
          />
        </div>}
      </div>
    </PrivateField>
  );
}
