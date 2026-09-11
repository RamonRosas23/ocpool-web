/**
 * Semantic tokens for private commercial surfaces.
 *
 * This module is intentionally not imported by the current legacy screens.
 * U1 will connect it from the private layouts after the G0 gate is closed.
 */

export const PRIVATE_UI_TOKENS = Object.freeze({
  '--private-color-canvas': '#f7f5ef',
  '--private-color-surface': '#fffdf8',
  '--private-color-surface-muted': '#eeeae1',
  '--private-color-ink': '#18252a',
  '--private-color-ink-muted': '#56615f',
  '--private-color-brand': '#092433',
  '--private-color-accent': '#1b5266',
  '--private-color-focus': '#b8894a',
  '--private-color-success': '#276b49',
  '--private-color-danger': '#913e35',
  '--private-color-border': 'rgba(24, 37, 42, .22)',
  '--private-color-border-strong': 'rgba(24, 37, 42, .42)',
  '--private-shadow-popover': '0 18px 50px rgba(5, 24, 34, .18)',
  '--private-font-interface': 'var(--font-interface, var(--font-sans, system-ui, sans-serif))',
  '--private-space-1': '4px',
  '--private-space-2': '8px',
  '--private-space-3': '12px',
  '--private-space-4': '16px',
  '--private-space-5': '20px',
  '--private-space-6': '24px',
  '--private-radius-control': '2px',
  '--private-radius-panel': '4px',
  '--private-motion-standard': '160ms ease',
  '--private-z-popover': '20',
  '--private-z-dialog': '30',
} as const);

export type PrivateUiTokenName = keyof typeof PRIVATE_UI_TOKENS;

export const PRIVATE_UI_BREAKPOINTS = Object.freeze({
  compact: '480px',
  tablet: '768px',
  desktop: '1024px',
  wide: '1440px',
} as const);

export const PRIVATE_UI_REQUIRED_TOKEN_GROUPS = Object.freeze([
  'color',
  'surface',
  'border',
  'shadow',
  'typography',
  'spacing',
  'radius',
  'motion',
  'focus',
  'z-index',
  'breakpoints',
] as const);
