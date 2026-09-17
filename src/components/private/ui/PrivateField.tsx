import type { ReactNode } from 'react';
import { privateFieldA11y } from './a11y';

export type PrivateFieldChromeProps = {
  id: string;
  label: string;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
};

export default function PrivateField({ id, label, description, error, required = false, hideLabel = false, className = '', children }: PrivateFieldChromeProps) {
  const a11y = privateFieldA11y(id, Boolean(description), Boolean(error), required);

  return (
    <div className={`private-field ${className}`.trim()}>
      <label className={hideLabel ? 'private-field__label--hidden' : 'private-field__label'} id={a11y.labelId} htmlFor={id}>
        <span>{label}</span>
        {!required && !hideLabel && <small>Opcional</small>}
      </label>
      {description && <p className="private-field__description" id={a11y.descriptionId}>{description}</p>}
      {children}
      {error && <p className="private-field__error" id={a11y.errorId} role="alert">{error}</p>}
    </div>
  );
}
