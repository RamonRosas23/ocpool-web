'use client';

import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { es } from 'react-day-picker/locale';

type DateFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
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

export default function DateField({ value, onValueChange, ariaLabel, id, disabled = false, min, max, placeholder = 'Selecciona una fecha' }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selected = parseDate(value);
  const minDate = parseDate(min ?? '');
  const maxDate = parseDate(max ?? '');

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
    <div className="ui-date-field" ref={rootRef}>
      <div className="ui-date-field__control">
        <input id={id} className="ui-date-field__input" type="text" inputMode="numeric" autoComplete="off" value={value} placeholder={placeholder} aria-label={ariaLabel} disabled={disabled} onChange={(event) => onValueChange(event.target.value)} />
        <button ref={triggerRef} className="ui-date-field__trigger" type="button" aria-label={`Abrir calendario: ${ariaLabel}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
          <span className="ui-date-field__icon" aria-hidden="true">▣</span>
        </button>
      </div>
      {open && <div ref={popoverRef} className="ui-date-field__popover" role="dialog" aria-label={ariaLabel}>
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
  );
}
