import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAFF_NAVIGATION, privateShellTrail } from '@/components/private/navigation';

const projectRoot = process.cwd();
const readProjectFile = (relativePath: string) =>
  readFileSync(join(projectRoot, relativePath), 'utf8');

describe('private shell route contract', () => {
  it('keeps the private stylesheet out of the public root layout', () => {
    const rootLayout = readProjectFile('src/app/layout.tsx');
    const privateLayouts = [
      'src/app/auth/layout.tsx',
      'src/app/login/layout.tsx',
      'src/app/portal/layout.tsx',
      'src/app/private-shell-harness/layout.tsx',
      'src/app/staff/layout.tsx',
    ];

    expect(rootLayout).not.toContain('components/private/ui/private-ui.css');

    for (const relativePath of privateLayouts) {
      expect(existsSync(join(projectRoot, relativePath))).toBe(true);
      expect(readProjectFile(relativePath)).toContain(
        'components/private/ui/private-ui.css',
      );
    }
  });

  it('gives each private surface a route-local brand destination', () => {
    const shellChrome = readProjectFile(
      'src/components/private/PrivateShellChrome.tsx',
    );

    expect(shellChrome).toContain("const brandHref = surface === 'staff' ? '/staff' : '/portal';");
    expect(shellChrome).toContain('href={brandHref}');
    expect(shellChrome).toContain('ariaLabel={brandAriaLabel}');
  });

  it('resolves a human return trail without exposing route mechanics', () => {
    expect(privateShellTrail('/staff/requests', 'staff', STAFF_NAVIGATION)).toEqual({
      currentLabel: 'Solicitudes',
      returnHref: '/staff',
      returnLabel: 'Dashboard',
    });
    expect(privateShellTrail('/staff/requests/abc', 'staff', STAFF_NAVIGATION)).toEqual({
      currentLabel: 'Solicitudes',
      returnHref: '/staff',
      returnLabel: 'Dashboard',
    });
    expect(privateShellTrail('/staff', 'staff', STAFF_NAVIGATION)).toBeNull();
    expect(privateShellTrail('/portal', 'portal', [{ key: 'portal', href: '/portal', label: 'Mis expedientes', capability: 'requestsRead' }])).toBeNull();
  });

  it('keeps one main landmark in the active private shell and preserves panel fallback roots', () => {
    const shell = readProjectFile('src/components/private/PrivateShell.tsx');
    expect(shell).toContain('<main id="contenido"');
    expect(shell).toContain('PrivateShellProvider');

    for (const relativePath of [
      'src/components/StaffAuditPanel.tsx',
      'src/components/StaffCatalogPanel.tsx',
      'src/components/StaffDashboardPanel.tsx',
      'src/components/StaffNotificationsPanel.tsx',
      'src/components/StaffQuotesPanel.tsx',
      'src/components/StaffRequestsPanel.tsx',
      'src/components/ClientPortalPanel.tsx',
    ]) {
      const panel = readProjectFile(relativePath);
      expect(panel).toContain('PrivateSurfaceRoot');
      expect(panel).not.toMatch(/<main\b/u);
    }
  });

  it('keeps the synthetic shell harness development-only', () => {
    const harness = readProjectFile('src/app/private-shell-harness/page.tsx');
    expect(harness).toContain("if (process.env.NODE_ENV === 'production') notFound();");
    expect(harness).toContain('PrivateShell');
    expect(harness).toContain("=== 'portal' ? 'portal' : 'staff'");
    expect(harness).toContain('STAFF_HARNESS_CONTEXT');
    expect(harness).toContain('PORTAL_HARNESS_CONTEXT');
    expect(harness).toContain('PORTAL_HARNESS_NAVIGATION');
  });

  it('keeps the harness E2E runner explicitly on the Next development server', () => {
    const packageJson = readProjectFile('package.json');
    const e2eServer = readProjectFile('scripts/start-e2e-server.mjs');

    expect(packageJson).toContain('test:e2e:private-shell');
    expect(packageJson).toContain('E2E_NEXT_MODE=dev');
    expect(e2eServer).toContain("process.env.E2E_NEXT_MODE ?? 'production'");
    expect(e2eServer).toContain("nextMode === 'dev' ? 'dev' : 'start'");
  });
});
