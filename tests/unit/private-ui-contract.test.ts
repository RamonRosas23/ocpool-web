import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { privateFieldA11y } from '@/components/private/ui/a11y';
import { PRIVATE_UI_BREAKPOINTS, PRIVATE_UI_REQUIRED_TOKEN_GROUPS, PRIVATE_UI_TOKENS } from '@/components/private/ui/tokens';

function cssScopeCustomPropertyNames(): Set<string> {
  const css = readFileSync(join(process.cwd(), 'src/components/private/ui/private-ui.css'), 'utf8');
  const scope = css.match(/\.private-ui-scope\s*\{([^}]*)\}/u)?.[1] ?? '';
  return new Set([...scope.matchAll(/(--private-[a-z0-9-]+):/gu)].map((match) => match[1]));
}

describe('private UI foundation contract', () => {
  it('keeps every JS token wired to a matching custom property in private-ui.css', () => {
    const cssNames = cssScopeCustomPropertyNames();
    for (const name of Object.keys(PRIVATE_UI_TOKENS)) {
      expect(cssNames.has(name), `${name} is declared in PRIVATE_UI_TOKENS but missing from .private-ui-scope in private-ui.css`).toBe(true);
    }
  });

  it('exposes semantic token groups without depending on the landing token names', () => {
    expect(Object.keys(PRIVATE_UI_TOKENS)).toEqual(expect.arrayContaining([
      '--private-color-canvas',
      '--private-color-surface',
      '--private-color-focus',
      '--private-space-4',
      '--private-motion-standard',
      '--private-z-dialog',
    ]));
    expect(PRIVATE_UI_REQUIRED_TOKEN_GROUPS).toEqual(expect.arrayContaining(['color', 'surface', 'focus', 'breakpoints']));
    expect(PRIVATE_UI_BREAKPOINTS).toMatchObject({ compact: '480px', tablet: '768px', desktop: '1024px', wide: '1440px' });
    expect(Object.keys(PRIVATE_UI_TOKENS).every((name) => name.startsWith('--private-'))).toBe(true);
  });

  it('generates stable field relationships for description and errors', () => {
    expect(privateFieldA11y('request-email', true, true, true)).toEqual({
      labelId: 'request-email-label',
      descriptionId: 'request-email-description',
      errorId: 'request-email-error',
      describedBy: 'request-email-description request-email-error',
      invalid: true,
      required: true,
    });
    expect(privateFieldA11y('request-phone', false, false)).toEqual({
      labelId: 'request-phone-label',
      descriptionId: 'request-phone-description',
      errorId: 'request-phone-error',
    });
  });
});
