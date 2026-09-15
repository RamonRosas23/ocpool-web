import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('private shell development harness', () => {
  test.skip(
    process.env.PRIVATE_SHELL_HARNESS_E2E !== '1' || process.env.E2E_NEXT_MODE !== 'dev',
    'Private shell harness E2E requires PRIVATE_SHELL_HARNESS_E2E=1 with E2E_NEXT_MODE=dev.',
  );

  for (const surface of ['staff', 'portal'] as const) {
    test(`${surface} remains accessible across the supported shell sizes`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/private-shell-harness?surface=${surface}`);

      await expect(page.getByRole('heading', { name: 'Shell privado verificable' })).toBeVisible();
      await expect(page.locator('main#contenido')).toHaveCount(1);
      await expect(page.locator('#contenido .private-harness__surface')).toHaveCount(1);
      await expect(page.getByRole('link', { name: surface === 'staff' ? 'OCPOOL, volver al centro de trabajo' : 'OCPOOL, volver a mis expedientes' }))
        .toHaveAttribute('href', surface === 'staff' ? '/staff' : '/portal');

      const navigation = page.locator('#private-shell-navigation');
      await expect(navigation.getByRole('link')).toHaveCount(surface === 'staff' ? 6 : 1);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('button', { name: 'Menú' })).toBeVisible();
      await page.getByRole('button', { name: 'Menú' }).click();
      await expect(navigation).toBeVisible();
      await page.getByRole('button', { name: 'Cerrar', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(navigation.getByRole('link').first()).toBeFocused();

      for (const width of [360, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
      }

      await page.setViewportSize({ width: 360, height: 844 });
      const shellTouchTargets = await page.locator('#private-shell-navigation a, .private-shell__menu-toggle, .private-shell__logout').evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
      expect(shellTouchTargets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

      await page.setViewportSize({ width: 180, height: 844 });
      const zoomOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(zoomOverflow, 'horizontal overflow at the 200% zoom-equivalent viewport').toBeLessThanOrEqual(1);

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }
});
