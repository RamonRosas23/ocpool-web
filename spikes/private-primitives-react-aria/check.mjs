import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const results = [];

for (const width of [360, 768, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  await page.goto(process.env.SPIKE_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Primitives privadas comparables' }).waitFor();

  const combo = page.getByRole('combobox', { name: 'Concepto del catálogo' });
  await combo.fill('vidrio');
  await page.getByRole('option', { name: /Vidrio templado/ }).waitFor({ state: 'visible' });
  await combo.press('ArrowDown');
  await combo.press('Enter');
  const select = page.getByRole('button', { name: /Lista de precios/ });
  await select.click();
  await page.getByRole('option', { name: 'Premium MXN' }).waitFor({ state: 'visible' });
  await page.getByRole('option', { name: 'Premium MXN' }).click();

  const calendarTrigger = page.getByRole('button', { name: 'Abrir calendario' });
  await calendarTrigger.click();
  const calendarDialog = page.getByRole('dialog', { name: 'Calendario de vigencia' });
  await calendarDialog.waitFor({ state: 'visible' });
  await page.getByRole('grid').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  if (await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) !== 'Abrir calendario') throw new Error(`calendar focus restore failed at ${width}px`);

  const dialogTrigger = page.getByRole('button', { name: /Revisar y aceptar/ });
  await dialogTrigger.click();
  const acceptanceDialog = page.getByRole('dialog', { name: 'Aceptar propuesta' });
  await acceptanceDialog.waitFor({ state: 'visible' });
  await acceptanceDialog.getByPlaceholder('Nombre completo').waitFor({ state: 'visible' });
  const total = acceptanceDialog.locator('[data-locale="es-MX"][data-currency="MXN"]');
  await total.waitFor({ state: 'visible' });
  if (await total.evaluate((element) => element.textContent !== new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', currencyDisplay: 'code' }).format(3480))) throw new Error(`es-MX currency formatting failed at ${width}px`);
  await page.keyboard.press('Escape');
  await waitForFocus(dialogTrigger, `dialog focus restore failed at ${width}px`);

  const messageTab = page.getByRole('tab', { name: /Mensajes/ });
  const filesTab = page.getByRole('tab', { name: 'Archivos' });
  await page.getByRole('tablist', { name: 'Contenido del expediente' }).waitFor({ state: 'visible' });
  await page.getByRole('tabpanel').waitFor({ state: 'visible' });
  await messageTab.focus();
  await messageTab.press('ArrowRight');
  if (await filesTab.getAttribute('aria-selected') !== 'true' || await filesTab.evaluate((element) => document.activeElement === element) !== true) throw new Error(`tabs keyboard failed at ${width}px`);
  await messageTab.press('Home');
  if (await messageTab.getAttribute('aria-selected') !== 'true') throw new Error(`tabs Home failed at ${width}px`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  let axeViolations = [];
  if (width === 1440) axeViolations = (await new AxeBuilder({ page }).analyze()).violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
  results.push({ width, overflow, consoleErrors, pageErrors, failedRequests, axeViolations: axeViolations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })) });
  await context.close();
}

console.log(JSON.stringify({ schemaVersion: 1, prototype: 'react-aria-components 1.21.1 + lucide-react 1.44.0', results }, null, 2));
if (results.some((result) => result.overflow || result.consoleErrors.length || result.pageErrors.length || result.failedRequests.length || result.axeViolations.length)) process.exitCode = 1;
await browser.close();

async function waitForFocus(locator, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await locator.evaluate((element) => document.activeElement === element)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}
