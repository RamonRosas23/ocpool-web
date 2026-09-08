import { test, expect } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './a11y';

const validPayload = {
  displayName: 'Prueba OCPOOL',
  phone: '667 000 0000',
  email: 'qa@example.com',
  projectType: 'Alberca residencial',
  location: 'Culiacán, Sinaloa',
  description: 'Solicitud de prueba automatizada.',
};

test.describe('OCPOOL quality contract', () => {
  test('keeps anchored section headings clear of the fixed header', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Cotizar', exact: true }).first().click();

    const metrics = await page.evaluate(() => {
      const header = document.querySelector('.site-header');
      const target = document.querySelector('#contacto');
      if (!header || !target) throw new Error('Header or contact section not found');
      return {
        headerBottom: header.getBoundingClientRect().bottom,
        targetTop: target.getBoundingClientRect().top,
      };
    });

    expect(metrics.targetTop).toBeGreaterThanOrEqual(metrics.headerBottom - 4);
  });

  test('prioritizes the hero image as the largest contentful paint candidate', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const heroImage = page.locator('img.hero__image');
    await expect(heroImage).toHaveAttribute('fetchpriority', 'high');
    await expect(heroImage).not.toHaveAttribute('loading', 'lazy');
  });

  test('provides a keyboard skip link to the main content', async ({ page }) => {
    await page.goto('/');

    const skipLink = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skipLink).toHaveAttribute('href', '#contenido');

    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#contenido$/);
  });

  test('closes the mobile menu with Escape and an outside click', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const toggle = page.locator('.menu-toggle');
    const navigation = page.locator('#primary-navigation');

    await toggle.click();
    await expect(navigation).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

    await toggle.click();
    await expect(navigation).toBeVisible();
    await page.mouse.click(12, 420);
    await expect(navigation).toBeHidden();
  });

  test('keeps project dialog focus contained and restores it to its trigger', async ({ page }) => {
    await page.goto('/');

    const trigger = page.getByRole('button', { name: 'Ver ficha del proyecto' }).first();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar proyecto' })).toBeFocused();

    for (let index = 0; index < 5; index += 1) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus').evaluate((element) => Boolean(element.closest('[role="dialog"]')))).resolves.toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('rejects a quote request without explicit server-side consent', async ({ request }) => {
    const response = await request.post('/api/quote-requests', {
      headers: { 'Idempotency-Key': `quality-consent-${Date.now()}-1234` },
      data: { ...validPayload, consent: false },
    });
    expect(response.status()).toBe(400);
  });

  test('accepts a quote request and returns a non-authenticating folio', async ({ request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const response = await request.post('/api/quote-requests', {
      headers: { 'Idempotency-Key': `quality-create-${suffix}-1234` },
      data: { ...validPayload, email: `qa-${suffix}@example.test`, consent: true },
    });
    expect(response.status()).toBe(201);
    const body = await response.json() as { accepted?: boolean; folio?: string };
    expect(body.accepted).toBe(true);
    expect(body.folio).toMatch(/^OCQ-\d{4}-\d{6}$/);
  });

  test('submits the public form and presents the persisted folio accessibly', async ({ page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await page.goto('/#contacto');
    await page.getByLabel('Nombre').fill('Cliente E2E OCPOOL');
    await page.getByLabel('Teléfono').fill('667 000 3344');
    await page.getByLabel('Correo').fill(`form-${suffix}@example.test`);
    await page.getByLabel('Tipo de obra').selectOption('Alberca residencial');
    await page.getByLabel('Ubicación').fill('Mazatlán, Sinaloa');
    await page.getByLabel('Descripción del proyecto').fill('Solicitud E2E para validar el expediente público.');
    await page.getByLabel(/Autorizo a OCPOOL/).check();
    await page.getByRole('button', { name: /Enviar solicitud/ }).click();

    const feedback = page.locator('.form-feedback--success');
    await expect(feedback).toHaveAttribute('role', 'status');
    await expect(feedback).toContainText(/Tu folio es OCQ-\d{4}-\d{6}/);
    await expect(page.getByRole('button', { name: /Enviar solicitud/ })).toBeDisabled();
  });

  test('protects the internal inbox when no employee session exists', async ({ page }) => {
    await page.goto('/staff/requests');
    await expect(page.getByRole('heading', { name: 'Acceso restringido.' })).toBeVisible();
    await expect(page.getByText('Inicia sesión con una cuenta de empleado autorizada')).toBeVisible();
  });

  test('protects the internal catalog when no employee session exists', async ({ page }) => {
    await page.goto('/staff/catalog');
    await expect(page.getByRole('heading', { name: 'Acceso restringido.' })).toBeVisible();
    await expect(page.getByText('Inicia sesión con una cuenta de empleado autorizada para consultar el catálogo.')).toBeVisible();
  });

  test('protects the quote builder when no employee session exists', async ({ page }) => {
    await page.goto('/staff/quotes');
    await expect(page.getByRole('heading', { name: 'Acceso restringido.' })).toBeVisible();
    await expect(page.getByText('Inicia sesión con una cuenta de empleado con permiso comercial para usar el constructor.')).toBeVisible();
  });

  test('protects the customer portal when no customer session exists', async ({ page }) => {
    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Acceso privado.' })).toBeVisible();
    await expect(page.getByText('Necesitas un enlace de acceso válido para consultar tus expedientes.')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('exposes complete SEO metadata and generated discovery routes', async ({ page, request }) => {
    await page.goto('/');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/www\.ocpool\.com\/?$/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /OCPOOL/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /albercas/i);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);

    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain('Sitemap: https://www.ocpool.com/sitemap.xml');

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('https://www.ocpool.com/');
  });

  test('has no horizontal overflow at supported viewport widths', async ({ page }) => {
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const metrics = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(metrics.content, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(metrics.viewport + 1);
    }
  });

  test('keeps construction guidance available to assistive technology', async ({ page }) => {
    await page.goto('/');
    const hint = page.locator('.construction-hint');
    await expect(hint).toContainText('Desliza para revisar propuesta, obra y entrega');
    await expect(hint).not.toHaveAttribute('aria-hidden', 'true');
  });

  test('adds a distinctive line icon to each project type card', async ({ page }) => {
    await page.goto('/#manifiesto');

    const icons = page.locator('.manifesto__profile-icon');
    await expect(icons).toHaveCount(3);
    await expect(icons.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-profile-icon')))).resolves.toEqual(['residencial', 'hospitalidad', 'existente']);

    const layout = await page.locator('.manifesto__profile article').first().evaluate((element) => {
      const icon = element.querySelector('.manifesto__profile-icon');
      const side = element.querySelector('.manifesto__profile-side');
      const copy = element.querySelector(':scope > .manifesto__profile-copy');
      if (!icon || !side || !copy) throw new Error('Project type card layout is incomplete');
      return {
        sideColumnStart: getComputedStyle(side).gridColumnStart,
        sideColumnEnd: getComputedStyle(side).gridColumnEnd,
        copyColumnStart: getComputedStyle(copy).gridColumnStart,
        copyColumnEnd: getComputedStyle(copy).gridColumnEnd,
        copyRowStart: getComputedStyle(copy).gridRowStart,
        copyRowEnd: getComputedStyle(copy).gridRowEnd,
      };
    });

    expect(layout.sideColumnStart).toBe('1');
    expect(layout.sideColumnEnd).toBe('2');
    expect(layout.copyColumnStart).toBe('2');
    expect(layout.copyColumnEnd).toBe('3');
    expect(layout.copyRowStart).toBe('1');
    expect(layout.copyRowEnd).toBe('2');

    for (const icon of await icons.all()) {
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
      await expect(icon).toHaveAttribute('fill', 'none');
      await expect(icon).toHaveAttribute('stroke', 'currentColor');
    }
  });

  test('renders the scope marker as a portable line icon', async ({ page }) => {
    await page.goto('/#manifiesto');

    const marker = page.locator('.manifesto__mark');
    await expect(marker).not.toContainText('↘');
    await expect(marker.locator('svg')).toHaveCount(1);
    await expect(marker.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(marker.locator('svg')).toHaveAttribute('viewBox', '0 0 48 48');

    await page.getByRole('button', { name: 'Ver ficha del proyecto' }).first().click();
    const legacySymbols = await page.locator('body').evaluate((body) => body.textContent?.match(/[↗↘→←↑↓×✕✖]/g) ?? []);
    expect(legacySymbols).toEqual([]);
    const arrowTags = await page.locator('.arrow').evaluateAll((elements) => elements.map((element) => element.tagName.toLowerCase()));
    expect(arrowTags.every((tagName) => tagName === 'svg')).toBe(true);
    await expect(page.locator('.dialog-close svg')).toHaveCount(1);
  });

  test('keeps project type cards compact without trailing whitespace', async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#manifiesto');

      const cardMetrics = await page.locator('.manifesto__profile article').first().evaluate((element) => {
        const cardBox = element.getBoundingClientRect();
        const contentBottom = Math.max(
          element.querySelector('.manifesto__profile-side')?.getBoundingClientRect().bottom ?? cardBox.top,
          element.querySelector('.manifesto__profile-copy')?.getBoundingClientRect().bottom ?? cardBox.top,
        );
        return { height: cardBox.height, trailingSpace: cardBox.bottom - contentBottom };
      });

      expect(cardMetrics.height, `card height at ${width}px`).toBeLessThanOrEqual(160);
      expect(cardMetrics.trailingSpace, `trailing card space at ${width}px`).toBeLessThanOrEqual(32);
    }
  });

  test('reveals editorial sections as they enter the viewport', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.hero__copy')).toHaveClass(/reveal-visible/);
    const services = page.locator('.services-list');
    await services.scrollIntoViewIfNeeded();
    await expect(services).toHaveClass(/reveal-visible/);
  });

  test('presents service dossiers with a clear quote action on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#servicios');

    const rows = page.locator('.service-row');
    await expect(rows).toHaveCount(5);
    await expect(rows.first().locator('.service-row__cta-label')).toHaveText('Cotizar servicio');

    const metrics = await rows.first().evaluate((element) => {
      const media = element.querySelector('.service-row__media');
      const cta = element.querySelector(':scope > a');
      if (!media || !cta) throw new Error('Service dossier structure is incomplete');
      return {
        mediaWidth: media.getBoundingClientRect().width,
        mediaHeight: media.getBoundingClientRect().height,
        ctaHeight: cta.getBoundingClientRect().height,
      };
    });

    expect(metrics.mediaWidth).toBeGreaterThanOrEqual(160);
    expect(metrics.mediaHeight).toBeGreaterThanOrEqual(96);
    expect(metrics.ctaHeight).toBeGreaterThanOrEqual(44);
  });

  test('turns service dossiers into spacious touch-friendly cards on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#servicios');

    const rows = page.locator('.service-row');
    await rows.first().scrollIntoViewIfNeeded();
    await expect(rows.first().locator('.service-row__cta-label')).toHaveText('Cotizar servicio');

    const metrics = await rows.first().evaluate((element) => {
      const media = element.querySelector('.service-row__media');
      const cta = element.querySelector(':scope > a');
      if (!media || !cta) throw new Error('Mobile service dossier structure is incomplete');
      return {
        mediaWidth: media.getBoundingClientRect().width,
        mediaHeight: media.getBoundingClientRect().height,
        ctaWidth: cta.getBoundingClientRect().width,
        ctaHeight: cta.getBoundingClientRect().height,
        contentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });

    expect(metrics.mediaWidth).toBeGreaterThanOrEqual(300);
    expect(metrics.mediaHeight).toBeGreaterThanOrEqual(150);
    expect(metrics.ctaWidth).toBeGreaterThanOrEqual(300);
    expect(metrics.ctaHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.contentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  });

  test('respects reduced motion while keeping content visible', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();

    await page.goto('/');

    await expect(page.locator('.hero__copy')).toHaveClass(/reveal-visible/);
    const motionState = await page.locator('.hero__copy').evaluate((element) => {
      const styles = getComputedStyle(element);
      return { opacity: styles.opacity, transform: styles.transform, transitionDelay: styles.transitionDelay };
    });
    expect(motionState.opacity).toBe('1');
    expect(motionState.transform).toBe('none');
    expect(Number.parseFloat(motionState.transitionDelay)).toBe(0);

    await context.close();
  });

  test('moves the active project filter indicator with the selected category', async ({ page }) => {
    await page.goto('/#proyectos');
    const delivered = page.getByRole('button', { name: 'Entregados', exact: true });

    await delivered.click();

    await expect(delivered).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.filter-button__active')).toHaveCount(1);
    await expect(page.locator('.project-index-bar')).toContainText('03 fichas');
  });

  test('keeps secondary project cards readable on mobile', async ({ page }) => {
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/#proyectos');

      const card = page.locator('.project-card:not(.project-card--featured)').first();
      await card.scrollIntoViewIfNeeded();
      const cardStyles = await card.evaluate((element) => {
        const copy = element.querySelector('.project-card__copy');
        const button = element.querySelector('.text-link');
        if (!copy || !button) throw new Error('Secondary project card structure is incomplete');
        return {
          copyPosition: getComputedStyle(copy).position,
          copyBackground: getComputedStyle(copy).backgroundColor,
          copyOverflow: getComputedStyle(copy).overflow,
          buttonColor: getComputedStyle(button).color,
          buttonText: button.textContent?.trim(),
        };
      });

      expect(cardStyles.copyPosition, `copy position at ${width}px`).toBe('static');
      expect(cardStyles.copyBackground, `copy background at ${width}px`).toBe('rgb(244, 241, 234)');
      expect(cardStyles.copyOverflow, `copy overflow at ${width}px`).toBe('visible');
      expect(cardStyles.buttonColor, `button color at ${width}px`).toBe('rgb(11, 39, 54)');
      expect(cardStyles.buttonText).toContain('Ver ficha del proyecto');
    }
  });

  test('presents a clear branded footer on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const footer = page.locator('.site-footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.locator('.footer-intro h2')).toContainText('proyecto');
    await expect(footer.getByRole('link', { name: /Iniciar conversación/i })).toBeVisible();
    await expect(footer.locator('.footer-main')).toHaveCSS('display', 'grid');
    await expect(footer.locator('.footer-bottom')).toContainText('OCPOOL');
  });

  test('builds the editorial footer with a full-bleed pool backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const visual = page.locator('.footer-media');
    const image = visual.locator('img');

    await expect(visual).toHaveAttribute('aria-hidden', 'true');
    await expect(image).toHaveAttribute('src', /footer-pool-scene/);
    await expect(image).toHaveAttribute('alt', '');
    await expect(visual).toHaveCSS('position', 'absolute');
    await expect(page.locator('.footer-media__veil')).toHaveCSS('position', 'absolute');
  });

  test('balances the evidence gallery with an editorial card rhythm', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const proof = page.locator('.proof-section');
    await proof.scrollIntoViewIfNeeded();
    const cardStyles = await proof.locator('.proof-card--4').evaluate((card) => {
      const styles = getComputedStyle(card);
      return {
        gridColumnStart: styles.gridColumnStart,
        gridColumnEnd: styles.gridColumnEnd,
        borderRadius: styles.borderTopLeftRadius,
      };
    });
    const proofSpacing = await proof.evaluate((section) => ({
      paddingTop: getComputedStyle(section).paddingTop,
      headingMarginBottom: getComputedStyle(section.querySelector('.section-heading')!).marginBottom,
    }));

    expect(cardStyles.gridColumnStart).toBe('2');
    expect(cardStyles.gridColumnEnd).toBe('-1');
    expect(cardStyles.borderRadius).toBe('6px');
    expect(proofSpacing.paddingTop).toBe('64px');
    expect(proofSpacing.headingMarginBottom).toBe('24px');
  });

  test('uses a copper keyline and upright serif captions in visual sections', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const proof = page.locator('.proof-section');
    const headingCopy = proof.locator('.section-heading > p');
    const caption = proof.locator('.proof-card figcaption strong').first();

    await expect(headingCopy).toHaveCSS('border-left-style', 'solid');
    await expect(headingCopy).toHaveCSS('border-left-width', '1px');
    await expect(caption).toHaveCSS('font-style', 'normal');
  });

  test('keeps process outcomes concise without repeated lead-in copy', async ({ page }) => {
    await page.goto('/');

    const process = page.locator('.process-section');
    const outcomes = process.locator('.process-step__outcome');

    await expect(page.locator('body')).not.toContainText('Se define:');
    await expect(outcomes).toHaveCount(4);
    await expect(outcomes.first()).toHaveText('Alcance de intervención');
  });

  test('gives secondary project CTAs a 44px mobile hit area', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#proyectos');

    const ctas = page.locator('.project-card:not(.project-card--featured) .text-link--card');
    await expect(ctas.first()).toHaveCSS('min-height', '44px');
  });

  test('keeps secondary project CTAs on one line at tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/#proyectos');

    const cta = page.locator('.project-card:not(.project-card--featured) .text-link--card').first();
    await expect(cta).toHaveCSS('white-space', 'nowrap');
  });

  test('assigns a distinct visual motif to each content section', async ({ page }) => {
    await page.goto('/');

    const motifs = await page.locator('[data-section-motif]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-section-motif')));
    expect(motifs).toEqual(['field-notes', 'bathymetry', 'orbit', 'datum', 'hydraulic-plan', 'route', 'ripples', 'coordinates', 'horizon']);
    expect(new Set(motifs).size).toBe(motifs.length);
  });

  test('has no serious accessibility violations on page, menu, or dialog', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero__copy')).toHaveClass(/reveal-visible/);
    await expectNoSeriousA11yViolations(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Ver ficha del proyecto' }).first().click();
    await expectNoSeriousA11yViolations(page);
  });

  test('does not emit browser console errors through the core flows', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Ver ficha del proyecto' }).first().click();
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Cotizar', exact: true }).first().click();

    expect(errors).toEqual([]);
  });
});
