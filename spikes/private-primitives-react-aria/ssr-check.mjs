import { createServer as createHttpServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SSR_SPIKE_PORT || 4175);
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const vite = await createViteServer({
  root,
  appType: 'custom',
  server: { middlewareMode: true },
});
const { default: App } = await vite.ssrLoadModule('/src/App.jsx');
const appMarkup = renderToString(React.createElement(App));
if (!appMarkup.includes('Primitives privadas comparables')) throw new Error('SSR output did not include the spike heading');

const template = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const serverDocument = await vite.transformIndexHtml('/', template.replace('<div id="root"></div>', `<div id="root">${appMarkup}</div>`));
const httpServer = createHttpServer(async (request, response) => {
  if (request.url === '/' || request.url === '/index.html') {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(serverDocument);
    return;
  }
  vite.middlewares(request, response, () => {
    response.statusCode = 404;
    response.end('Not found');
  });
});

await new Promise((resolve) => httpServer.listen(port, '127.0.0.1', resolve));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleMessages.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Primitives privadas comparables' }).waitFor();
  const renderMode = await page.locator('#root').getAttribute('data-render-mode');
  const rootText = await page.locator('#root').innerText();
  const result = { schemaVersion: 1, renderMode, serverMarkupBytes: Buffer.byteLength(serverDocument), consoleMessages, pageErrors, failedRequests };
  console.log(JSON.stringify(result, null, 2));
  if (renderMode !== 'hydration' || !rootText.includes('Primitives privadas comparables') || consoleMessages.length || pageErrors.length || failedRequests.length) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  await vite.close();
}
