'use client';

import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { es } from 'react-day-picker/locale';
import { privateFieldA11y } from './a11y';
import PrivateField, { type PrivateFieldChromeProps } from './PrivateField';

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export type PrivateDatePickerProps = Omit<PrivateFieldChromeProps, 'children'> & {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
};

function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function PrivateDatePicker({ id, label, description, error, required, hideLabel, className, value, onValueChange, placeholder = 'Selecciona una fecha', disabled = false, min, max }: PrivateDatePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selected = parseDate(value);
  const minDate = parseDate(min ?? '');
  const maxDate = parseDate(max ?? '');
  const a11y = privateFieldA11y(id, Boolean(description), Boolean(error), required);

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
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Escape') triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <PrivateField id={id} label={label} description={description} error={error} required={required} hideLabel={hideLabel}>
      <div className={joinClasses('private-date-field', className)} ref={rootRef}>
        <div className="private-date-field__control">
          <input id={id} className="private-control private-date-field__input" type="text" inputMode="numeric" autoComplete="off" value={value} placeholder={placeholder} disabled={disabled} aria-describedby={a11y.describedBy} aria-invalid={a11y.invalid} aria-labelledby={a11y.labelId} aria-required={a11y.required} onChange={(event) => onValueChange(event.target.value)} />
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
