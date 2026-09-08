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
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [{
      source: '/(.*)',
      headers: Object.entries(globalSecurityHeaders).map(([key, value]) => ({ key, value })),
    }];
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
