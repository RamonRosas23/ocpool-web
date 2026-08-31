type Direction = 'up-right' | 'right' | 'down-right';

type DirectionalIconProps = {
  direction?: Direction;
  className?: string;
};

const directionPaths: Record<Direction, string[]> = {
  'up-right': ['M5 19 19 5', 'M10 5h9v9'],
  right: ['M4 12h16', 'm14 6 6 6-6 6'],
  'down-right': ['M10 10 38 38', 'M26 38h12V26'],
};

export function DirectionalIcon({ direction = 'up-right', className = 'arrow' }: DirectionalIconProps) {
  return (
    <svg
      className={className}
      viewBox={direction === 'down-right' ? '0 0 48 48' : '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      strokeWidth={direction === 'down-right' ? '1.2' : '1.6'}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {directionPaths[direction].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg className="dialog-close__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
