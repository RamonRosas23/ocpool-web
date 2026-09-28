import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** `include` limita la revisión a una parte de la página (p. ej. un listbox abierto sobre el resto). */
export async function expectNoSeriousA11yViolations(page: Page, options: { include?: string } = {}): Promise<void> {
  const builder = new AxeBuilder({ page });
  const results = await (options.include ? builder.include(options.include) : builder).analyze();
  const seriousViolations = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
  expect(seriousViolations, JSON.stringify(seriousViolations, null, 2)).toEqual([]);
}
