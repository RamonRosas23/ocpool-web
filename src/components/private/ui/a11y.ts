export type PrivateFieldA11y = {
  labelId: string;
  descriptionId: string;
  errorId: string;
  describedBy?: string;
  invalid?: true;
  required?: true;
};

export function privateFieldA11y(id: string, hasDescription: boolean, hasError: boolean, required = false): PrivateFieldA11y {
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = [hasDescription ? descriptionId : '', hasError ? errorId : ''].filter(Boolean).join(' ');

  return {
    labelId: `${id}-label`,
    descriptionId,
    errorId,
    ...(describedBy ? { describedBy } : {}),
    ...(hasError ? { invalid: true } : {}),
    ...(required ? { required: true } : {}),
  };
}
