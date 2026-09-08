import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
  expect(seriousViolations, JSON.stringify(seriousViolations, null, 2)).toEqual([]);
}
