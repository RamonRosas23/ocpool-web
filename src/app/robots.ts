import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://ocpool.com.mx/sitemap.xml',
    host: 'https://ocpool.com.mx',
  };
}
