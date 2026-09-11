import { chromium } from '@playwright/test';
import process from 'node:process';

const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:3008';
const surfaces = ['/', '/login', '/portal/access', '/staff', '/staff/requests', '/staff/quotes', '/staff/notifications', '/portal'];
const viewports = [
  { id: 'mobile', width: 390, height: 844 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', width: 1440, height: 900 },
];

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    baseUrl: new URL(baseUrl).origin,
    browser: 'chromium',
    status: 'BLOCKED',
    reason: 'browser_launch_failed',
    errorType: error instanceof Error ? error.name : 'UnknownError',
  }, null, 2)}\n`);
  process.exit(2);
}
const results = [];
let failed = false;

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
    for (const surface of surfaces) {
      const page = await context.newPage();
      const consoleErrors = [];
      let pageErrors = 0;
      const unexpectedResponses = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', () => { pageErrors += 1; });
      page.on('response', (response) => {
        const status = response.status();
        if (status >= 400 && status !== 401 && status !== 403) unexpectedResponses.push({ status, url: new URL(response.url()).pathname });
      });
      const startedAt = performance.now();
      let response = null;
      try {
        response = await page.goto(new URL(surface, baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(250);
        const metrics = await page.evaluate(() => {
          const navigation = performance.getEntriesByType('navigation')[0];
          return {
            title: document.title,
            scrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            responseStart: navigation?.responseStart ?? null,
            domContentLoaded: navigation?.domContentLoadedEventEnd ?? null,
            load: navigation?.loadEventEnd ?? null,
            transferSize: navigation?.transferSize ?? null,
          };
        });
        const expectedAuthConsoleErrors = consoleErrors.filter((message) => /^Failed to load resource: the server responded with a status of (401|403)\b/u.test(message));
        const unexpectedConsoleErrors = consoleErrors.length - expectedAuthConsoleErrors.length;
        const result = {
          surface,
          viewport: viewport.id,
          status: response?.status() ?? null,
          elapsedMs: Math.round(performance.now() - startedAt),
          consoleErrors: consoleErrors.length,
          expectedAuthConsoleErrors: expectedAuthConsoleErrors.length,
          unexpectedConsoleErrors,
          pageErrors,
          unexpectedResponses,
          horizontalOverflow: metrics.scrollWidth > metrics.viewportWidth,
          ...metrics,
        };
        results.push(result);
        if ((result.status ?? 500) >= 500 || result.unexpectedConsoleErrors > 0 || result.pageErrors > 0 || result.unexpectedResponses.length > 0 || result.horizontalOverflow) failed = true;
      } catch (error) {
        failed = true;
        results.push({ surface, viewport: viewport.id, status: null, elapsedMs: Math.round(performance.now() - startedAt), error: error instanceof Error ? error.name : 'UnknownError' });
      } finally {
        await page.close();
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const summary = {
  schemaVersion: 1,
  baseUrl: new URL(baseUrl).origin,
  generatedAt: new Date().toISOString(),
  surfaces,
  viewports,
  resultCount: results.length,
  failed,
  results,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = failed ? 1 : 0;
