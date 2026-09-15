export type PrivateFieldA11y = {
  labelId: string;
  descriptionId: string;
  errorId: string;
  describedBy?: string;
  invalid?: true;
  required?: true;
};

/**
 * Roving-tabindex arithmetic for a horizontal tablist (ArrowLeft/Right/Up/Down, Home, End).
 * Returns the index to focus next, or null when the key isn't a roving-tabindex key.
 */
export function nextRovingTabIndex(key: string, currentIndex: number, count: number): number | null {
  if (currentIndex < 0 || count < 2) return null;
  const direction = key === 'ArrowRight' || key === 'ArrowDown' ? 1
    : key === 'ArrowLeft' || key === 'ArrowUp' ? -1
    : key === 'Home' ? 0
    : key === 'End' ? count - 1
    : null;
  if (direction === null) return null;
  return key === 'Home' || key === 'End' ? direction : (currentIndex + direction + count) % count;
}

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
