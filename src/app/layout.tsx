import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Cormorant_Garamond, Manrope } from 'next/font/google';
import './globals.css';

const siteUrl = 'https://ocpool.com.mx';
const siteTitle = 'OCPOOL | Diseño y construcción de albercas';
const siteDescription = 'OCPOOL desarrolla soluciones integrales para albercas, jacuzzis y espacios acuáticos: diseño, construcción, equipamiento e iluminación.';

const display = Cormorant_Garamond({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const sans = Manrope({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    url: siteUrl,
    siteName: 'OCPOOL',
    title: siteTitle,
    description: siteDescription,
    images: [{ url: '/proyectos/cdp/hero.jpg', width: 2560, height: 1440, alt: 'Alberca terminada del Club de Playa CDP frente al mar' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: ['/proyectos/cdp/hero.jpg'],
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const locale = requestHeaders.get('x-ocpool-private-locale') === 'es-MX' ? 'es-MX' : 'es';

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${display.variable} ${sans.variable}`}>
        <a className="skip-link" href="#contenido">Saltar al contenido</a>
        {children}
      </body>
    </html>
  );
}
