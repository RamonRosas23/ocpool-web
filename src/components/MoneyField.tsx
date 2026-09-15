'use client';

import { parseMoneyInput } from '@/lib/money-input';

type MoneyFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
};

export default function MoneyField({ value, onValueChange, ariaLabel, id, disabled = false, placeholder = '0.00', required = false }: MoneyFieldProps) {
  const isInvalid = value !== '' && parseMoneyInput(value) === null;

  return (
    <div className="ui-money-field">
      <span className="ui-money-field__prefix" aria-hidden="true">$</span>
      <input
        id={id}
        className="ui-money-field__input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        required={required}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={isInvalid}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      />
    </div>
  );
}
