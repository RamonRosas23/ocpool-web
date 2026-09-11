'use client';

import * as Select from '@radix-ui/react-select';

export type SelectFieldOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectFieldProps = {
  value: string | null | undefined;
  options: SelectFieldOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
  className?: string;
};

const EMPTY_VALUE = '__ocpool_empty__';

export default function SelectField({ value, options, onValueChange, placeholder = 'Selecciona una opción', ariaLabel, id, disabled = false, className = '' }: SelectFieldProps) {
  const selectedValue = value || EMPTY_VALUE;

  return (
    <Select.Root value={selectedValue} onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_VALUE ? '' : nextValue)} disabled={disabled}>
      <Select.Trigger id={id} className={`ui-select__trigger ${className}`.trim()} aria-label={ariaLabel}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="ui-select__icon" aria-hidden="true">⌄</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="ui-select__content" position="popper" sideOffset={6} collisionPadding={10}>
          <Select.ScrollUpButton className="ui-select__scroll-button">↑</Select.ScrollUpButton>
          <Select.Viewport className="ui-select__viewport">
            <Select.Item className="ui-select__item" value={EMPTY_VALUE}>
              <Select.ItemText>{placeholder}</Select.ItemText>
              <Select.ItemIndicator className="ui-select__item-indicator">✓</Select.ItemIndicator>
            </Select.Item>
            {options.filter((option) => option.value !== '').map((option) => (
              <Select.Item className="ui-select__item" value={option.value} disabled={option.disabled} key={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="ui-select__item-indicator">✓</Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="ui-select__scroll-button">↓</Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
