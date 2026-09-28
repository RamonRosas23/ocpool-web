import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandContact, brandWebsiteLabel } from '@/lib/brand';
import { contactDetails } from '@/lib/pool-content';

describe('brand identity', () => {
  it('shares one contact source between the site, emails and documents', () => {
    expect(contactDetails).toBe(brandContact);
    expect(brandWebsiteLabel).toBe('ocpool.com.mx');
  });

  it('ships optimized logos and the embedded fonts with their licenses', () => {
    const files: ReadonlyArray<readonly [string, number]> = [
      ['public/brand/email/ocpool-logo-blanco.png', 40_000],
      ['src/server/modules/quote-documents/assets/ocpool-logo-print.png', 90_000],
      ['src/server/modules/quote-documents/assets/fonts/CormorantGaramond-SemiBold.ttf', 1_200_000],
      ['src/server/modules/quote-documents/assets/fonts/Manrope-Regular.ttf', 200_000],
      ['src/server/modules/quote-documents/assets/fonts/Manrope-SemiBold.ttf', 200_000],
      ['src/server/modules/quote-documents/assets/fonts/Manrope-Bold.ttf', 200_000],
      ['src/server/modules/quote-documents/assets/fonts/OFL-CormorantGaramond.txt', 10_000],
      ['src/server/modules/quote-documents/assets/fonts/OFL-Manrope.txt', 10_000],
    ];
    for (const [file, maxBytes] of files) {
      const absolute = path.resolve(process.cwd(), file);
      expect(existsSync(absolute), file).toBe(true);
      expect(statSync(absolute).size, file).toBeLessThan(maxBytes);
    }
  });
});
