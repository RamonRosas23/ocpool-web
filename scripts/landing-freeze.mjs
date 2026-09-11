import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';

const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:3008';
const outputDirectory = process.env.LANDING_FREEZE_OUTPUT_DIR ?? '/var/tmp/ocpool-landing-freeze';
const manifestPath = process.env.LANDING_FREEZE_MANIFEST ?? 'docs/ocpool-commercial-v2/landing-freeze.json';
const viewports = [
  { id: 'mobile', width: 390, height: 844 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', width: 1440, height: 900 },
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    baseUrl: new URL(baseUrl).origin,
    route: '/',
    status: 'BLOCKED',
    reason: 'browser_launch_failed',
    errorType: error instanceof Error ? error.name : 'UnknownError',
  }, null, 2)}\n`);
  process.exit(2);
}

const results = [];
try {
  await mkdir(outputDirectory, { recursive: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const response = await page.goto(new URL('/', baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
    const screenshot = await page.screenshot({ fullPage: true, animations: 'disabled' });
    const screenshotFile = `landing-${viewport.id}.png`;
    const screenshotPath = `${outputDirectory}/${screenshotFile}`;
    await writeFile(screenshotPath, screenshot);
    results.push({
      viewport,
      status: response?.status() ?? null,
      title: await page.title(),
      screenshotSha256: sha256(screenshot),
      screenshotFile,
      horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    });
    await page.close();
    await context.close();
  }
} finally {
  await browser.close();
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseUrl: new URL(baseUrl).origin,
  route: '/',
  landingTouched: false,
  results,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
process.exitCode = results.every((result) => result.status === 200 && !result.horizontalOverflow) ? 0 : 1;
