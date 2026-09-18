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

  it('renders a hidden field label as a real associated <label>, never a bare aria-label (U1-02 parte 2)', () => {
    const field = readFileSync(join(process.cwd(), 'src/components/private/ui/PrivateField.tsx'), 'utf8');
    expect(field).toContain('hideLabel');
    expect(field).toContain("htmlFor={id}");
    expect(field).toContain("hideLabel ? 'private-field__label--hidden' : 'private-field__label'");
    expect(field).toContain('!required && !hideLabel && <small>Opcional</small>');

    const css = readFileSync(join(process.cwd(), 'src/components/private/ui/private-ui.css'), 'utf8');
    expect(css).toContain('.private-field__label--hidden');
  });

  it('validates PrivateMoneyField input through the real money-input parser (U1-02 parte 3)', () => {
    const controls = readFileSync(join(process.cwd(), 'src/components/private/ui/PrivateControls.tsx'), 'utf8');
    expect(controls).toContain("import { parseMoneyInput } from '@/lib/money-input'");
    expect(controls).toContain('const isInvalid = value !== \'\' && parseMoneyInput(value) === null');
    expect(controls).toContain('private-money-field__prefix');

    const datePicker = readFileSync(join(process.cwd(), 'src/components/private/ui/PrivateDatePicker.tsx'), 'utf8');
    expect(datePicker).toContain("from 'react-day-picker'");
    expect(datePicker).toContain('triggerRef.current?.focus()');
  });

  it('consolidates focus-trap, focus-restore and Escape handling in PrivateDialog (U1-02 parte 4)', () => {
    const dialog = readFileSync(join(process.cwd(), 'src/components/private/ui/PrivateDialog.tsx'), 'utf8');
    expect(dialog).toContain('function focusableElements(');
    expect(dialog).toContain("document.activeElement instanceof HTMLElement ? document.activeElement : null");
    expect(dialog).toContain('previouslyFocusedRef.current?.focus()');
    expect(dialog).toContain("event.key === 'Escape'");
    expect(dialog).toContain("document.body.style.overflow = 'hidden'");

    const clientAcceptance = readFileSync(join(process.cwd(), 'src/components/ClientQuoteActions.tsx'), 'utf8');
    expect(clientAcceptance).toContain("import { PrivateDialog } from '@/components/private/ui'");
    expect(clientAcceptance).toContain('<PrivateDialog');

    const requestActions = readFileSync(join(process.cwd(), 'src/components/RequestWorkspaceActionsV2.tsx'), 'utf8');
    expect(requestActions).toContain('PrivateDialog');
    expect(requestActions).toContain('modal={false}');
  });

  it('activates .private-ui-scope unconditionally on all four private surfaces (U1-01 parte 3)', () => {
    for (const layoutPath of ['src/app/auth/layout.tsx', 'src/app/login/layout.tsx', 'src/app/staff/layout.tsx', 'src/app/portal/layout.tsx']) {
      const layout = readFileSync(join(process.cwd(), layoutPath), 'utf8');
      expect(layout, `${layoutPath} must always render a private-ui-scope wrapper, independent of the commercialWorkspaceV2 flag`).toContain('className="private-ui-scope"');
    }

    const privateShell = readFileSync(join(process.cwd(), 'src/components/private/PrivateShell.tsx'), 'utf8');
    expect(privateShell, 'PrivateShell must not duplicate the scope its layout already provides').not.toContain('private-ui-scope');
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
