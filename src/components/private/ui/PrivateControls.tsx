'use client';

import Link from 'next/link';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import { privateFieldA11y } from './a11y';
import PrivateField, { type PrivateFieldChromeProps } from './PrivateField';
import { parseMoneyInput } from '@/lib/money-input';

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export type PrivateButtonProps = ComponentPropsWithoutRef<'button'> & {
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
};

export const PrivateButton = forwardRef<HTMLButtonElement, PrivateButtonProps>(function PrivateButton({ busy = false, variant = 'primary', disabled = false, className, children, ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      className={joinClasses('private-button', `private-button--${variant}`, className)}
      aria-busy={busy || undefined}
      disabled={busy || disabled}
    >
      {busy && <span className="private-button__busy" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
});

export type PrivateIconButtonProps = Omit<PrivateButtonProps, 'children'> & {
  label: string;
  children: ReactNode;
};

export function PrivateIconButton({ label, className, children, ...props }: PrivateIconButtonProps) {
  return <PrivateButton {...props} className={joinClasses('private-icon-button', className)} aria-label={label} title={label}>{children}</PrivateButton>;
}

export type PrivateLinkButtonProps = ComponentPropsWithoutRef<typeof Link> & {
  variant?: 'primary' | 'secondary' | 'quiet';
};

export function PrivateLinkButton({ variant = 'primary', className, ...props }: PrivateLinkButtonProps) {
  return <Link {...props} className={joinClasses('private-button', `private-button--${variant}`, className)} />;
}

type PrivateTextFieldProps = Omit<PrivateFieldChromeProps, 'children'> & Omit<ComponentPropsWithoutRef<'input'>, 'id' | 'aria-describedby' | 'aria-invalid' | 'aria-labelledby' | 'aria-required'>;

export function PrivateTextField({ id, label, description, error, required, className, ...props }: PrivateTextFieldProps) {
  const a11y = privateFieldA11y(id, Boolean(description), Boolean(error), required);
  return (
    <PrivateField id={id} label={label} description={description} error={error} required={required}>
      <input {...props} id={id} className={joinClasses('private-control', className)} aria-describedby={a11y.describedBy} aria-invalid={a11y.invalid} aria-labelledby={a11y.labelId} aria-required={a11y.required} />
    </PrivateField>
  );
}

type PrivateTextAreaProps = Omit<PrivateFieldChromeProps, 'children'> & Omit<ComponentPropsWithoutRef<'textarea'>, 'id' | 'aria-describedby' | 'aria-invalid' | 'aria-labelledby' | 'aria-required'>;

export function PrivateTextArea({ id, label, description, error, required, className, ...props }: PrivateTextAreaProps) {
  const a11y = privateFieldA11y(id, Boolean(description), Boolean(error), required);
  return (
    <PrivateField id={id} label={label} description={description} error={error} required={required}>
      <textarea {...props} id={id} className={joinClasses('private-control private-control--area', className)} aria-describedby={a11y.describedBy} aria-invalid={a11y.invalid} aria-labelledby={a11y.labelId} aria-required={a11y.required} />
    </PrivateField>
  );
}

export function PrivateNumberField(props: PrivateTextFieldProps) {
  return <PrivateTextField {...props} type="number" inputMode="decimal" />;
}

export type PrivateMoneyFieldProps = Omit<PrivateFieldChromeProps, 'children'> & {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function PrivateMoneyField({ id, label, description, error, required, hideLabel, className, value, onValueChange, placeholder = '0.00', disabled = false }: PrivateMoneyFieldProps) {
  const isInvalid = value !== '' && parseMoneyInput(value) === null;
  const a11y = privateFieldA11y(id, Boolean(description), Boolean(error) || isInvalid, required);
  return (
    <PrivateField id={id} label={label} description={description} error={error} required={required} hideLabel={hideLabel}>
      <div className={joinClasses('private-money-field', className)}>
        <span className="private-money-field__prefix" aria-hidden="true">$</span>
        <input id={id} className="private-control private-money-field__input" type="text" inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} disabled={disabled} aria-describedby={a11y.describedBy} aria-invalid={a11y.invalid} aria-labelledby={a11y.labelId} aria-required={a11y.required} onChange={(event) => onValueChange(event.target.value)} />
      </div>
    </PrivateField>
  );
}

export function PrivatePercentField(props: PrivateTextFieldProps) {
  return <PrivateTextField {...props} inputMode="decimal" />;
}

export type PrivateSelectOption = { value: string; label: string; disabled?: boolean };
export type PrivateSelectProps = Omit<PrivateFieldChromeProps, 'children'> & {
  value?: string;
  options: readonly PrivateSelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

const EMPTY_SELECT_VALUE = '__private_ui_empty__';

export function PrivateSelect({ id, label, description, error, required, hideLabel, className, value, options, onValueChange, placeholder = 'Selecciona una opción', disabled = false }: PrivateSelectProps) {
  const a11y = privateFieldA11y(id, Boolean(description), Boolean(error), required);
  const selectedValue = value || EMPTY_SELECT_VALUE;
  return (
    <PrivateField id={id} label={label} description={description} error={error} required={required} hideLabel={hideLabel}>
      <SelectPrimitive.Root value={selectedValue} onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_SELECT_VALUE ? '' : nextValue)} disabled={disabled}>
        <SelectPrimitive.Trigger id={id} className={joinClasses('private-control private-select__trigger', className)} aria-describedby={a11y.describedBy} aria-invalid={a11y.invalid} aria-labelledby={a11y.labelId} aria-required={a11y.required}>
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon aria-hidden="true"><ChevronDown size={16} /></SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="private-select__content" position="popper" sideOffset={6} collisionPadding={10}>
            <SelectPrimitive.Viewport className="private-select__viewport">
              <SelectPrimitive.Item className="private-select__item" value={EMPTY_SELECT_VALUE}>
                <SelectPrimitive.ItemText>{placeholder}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
              {options.filter((option) => option.value !== '').map((option) => (
                <SelectPrimitive.Item className="private-select__item" value={option.value} disabled={option.disabled} key={option.value}>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator aria-hidden="true">✓</SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </PrivateField>
  );
}
