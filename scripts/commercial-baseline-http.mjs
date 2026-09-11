import process from 'node:process';

const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:3008';
const routes = [
  '/login',
  '/portal/access',
  '/staff',
  '/staff/requests',
  '/staff/quotes',
  '/portal',
  '/api/health',
  '/api/ready',
  '/robots.txt',
  '/sitemap.xml',
];

const results = [];
let failed = false;

for (const route of routes) {
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(route, baseUrl), {
      headers: { 'user-agent': 'ocpool-commercial-baseline/1.0' },
      redirect: 'manual',
    });
    const body = await response.arrayBuffer();
    const result = {
      route,
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
      bytes: body.byteLength,
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      location: response.headers.get('location'),
      poweredBy: response.headers.get('x-powered-by'),
      strictTransportSecurity: response.headers.get('strict-transport-security'),
    };
    results.push(result);
    if (result.status >= 500 || result.poweredBy) failed = true;
  } catch (error) {
    failed = true;
    results.push({ route, status: null, elapsedMs: Math.round(performance.now() - startedAt), errorType: error instanceof Error ? error.name : 'UnknownError' });
  }
}

const summary = {
  schemaVersion: 1,
  baseUrl: new URL(baseUrl).origin,
  generatedAt: new Date().toISOString(),
  routeCount: routes.length,
  failed,
  results,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = failed ? 1 : 0;

