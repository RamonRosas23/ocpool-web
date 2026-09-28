import type { NextConfig } from "next";
import bundleAnalyzer from '@next/bundle-analyzer';
import { getSecurityHeaders } from './src/server/security/http-headers';

const globalSecurityHeaders = getSecurityHeaders({
  production: process.env.NODE_ENV === 'production',
  https: process.env.APP_URL?.startsWith('https://') === true,
});

const nextConfig: NextConfig = {
  /* config options here */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  async headers() {
    const { 'X-Frame-Options': frameOptions, 'Content-Security-Policy': contentSecurityPolicy, ...commonHeaders } = globalSecurityHeaders;
    const toHeaders = (entries: Record<string, string | undefined>) => Object.entries(entries).flatMap(([key, value]) => (value ? [{ key, value }] : []));
    return [
      { source: '/(.*)', headers: toHeaders(commonHeaders) },
      // La pasarela de archivos privados decide su propio encuadre: la vista previa del PDF se muestra
      // en un iframe del mismo sitio y todo lo demás se niega (ver storage-gateway.ts).
      { source: '/:path((?!api/storage/object$).*)', headers: toHeaders({ 'X-Frame-Options': frameOptions, 'Content-Security-Policy': contentSecurityPolicy }) },
    ];
  },
  // Ignorar advertencias de hidratación causadas por extensiones del navegador
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn']
    } : false,
  },
};

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

export default withBundleAnalyzer(nextConfig);
