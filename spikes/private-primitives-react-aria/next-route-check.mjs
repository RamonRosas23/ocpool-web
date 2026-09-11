import { chromium } from 'playwright';

const appUrl = (process.env.APP_URL || 'http://127.0.0.1:3008').replace(/\/$/u, '');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const routes = ['/login', '/portal/access', '/staff', '/staff/requests', '/staff/quotes', '/portal'];
const widths = [390, 1440];
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const results = [];

for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  for (const route of routes) {
    const page = await context.newPage();
    const consoleMessages = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') consoleMessages.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      const failure = request.failure();
      const headers = request.headers();
      if (failure?.errorText === 'net::ERR_ABORTED' && headers['next-router-prefetch'] === '1') return;
      failedRequests.push(`${request.method()} ${request.url()}`);
    });
    const response = await page.goto(`${appUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
    const status = response?.status() ?? 0;
    const contentType = response?.headers()['content-type'] || '';
    const headingCount = await page.getByRole('heading').count();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const language = await page.locator('html').getAttribute('lang');
    const expectedConsoleMessages = consoleMessages.filter((message) => /401 \(Unauthorized\)/u.test(message));
    const unexpectedConsoleMessages = consoleMessages.filter((message) => !/401 \(Unauthorized\)/u.test(message));
    results.push({ width, route, status, contentType, headingCount, language, localeGap: language !== 'es-MX', overflow, consoleMessages, expectedConsoleMessages, unexpectedConsoleMessages, pageErrors, failedRequests });
    await page.close();
  }
  await context.close();
}

console.log(JSON.stringify({ schemaVersion: 1, runtime: 'next-anonymous-routes', appUrl, routes, widths, results }, null, 2));
if (results.some((result) => result.status < 200 || result.status >= 400 || !result.contentType.includes('text/html') || result.headingCount === 0 || result.overflow || result.unexpectedConsoleMessages.length || result.pageErrors.length || result.failedRequests.length)) process.exitCode = 1;
await browser.close();
