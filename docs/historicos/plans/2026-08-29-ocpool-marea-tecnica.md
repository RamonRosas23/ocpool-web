# OCPOOL Marea Técnica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task by task, with verification after each meaningful change.

**Goal:** Apply the approved Marea Técnica visual system to the OCPOOL landing page while preserving current behavior and improving responsive cards, controls, decoration, motion and measurable QA.

**Architecture:** Keep the current Next App Router structure and content model. Express section-specific ambient graphics in `src/app/globals.css` with scoped pseudo-elements and modifiers; make only the minimal JSX changes needed for semantic section markers or stable card hooks. Extend the existing Playwright contract rather than creating a second test harness.

**Tech Stack:** Next.js 15, React 19, TypeScript, CSS, existing Motion integration, Playwright Test and Axe.

**Spec:** `docs/historicos/specs/2026-08-29-ocpool-marea-tecnica-spec.md`

## Global constraints

- Preserve current copy, verified contact data, image originals and App Router behavior.
- Do not add GSAP, Lenis, a 3D renderer or another animation runtime.
- Use `apply_patch` for source, test and documentation edits.
- Add regression assertions before production changes and confirm they fail for the missing behavior.
- Keep decorative layers pointer-events-free and prevent horizontal overflow.
- Do not claim completion without fresh lint, content tests, E2E/Axe tests and production build evidence.

## Files and responsibilities

- Modify `src/app/globals.css`: section motifs, card sizing, button hit areas, focus states, responsive rules and reduced-motion overrides.
- Modify `src/app/page.tsx` only if section modifiers or semantic decorative hooks are required.
- Modify `src/components/ProjectShowcase.tsx` only if stable card semantics or data attributes are needed for visual QA.
- Modify `tests/quality.spec.ts`: responsive, contrast/visibility, motif uniqueness and touch-target regression checks.
- Create `docs/historicos/specs/2026-08-29-ocpool-marea-tecnica-spec.md`: approved design contract.
- Create `docs/historicos/plans/2026-08-29-ocpool-marea-tecnica.md`: executable implementation plan.

## Tasks

### Task 1: Establish failing visual QA assertions

**Files:**
- Modify: `tests/quality.spec.ts`

**Interfaces:**
- Consumes: existing Playwright server and current page selectors.
- Produces: executable assertions for mobile touch targets, 1024px CTA layout and section motif uniqueness.

- [x] **Step 1: Add failing assertions** for each approved behavior:

```ts
test('secondary project CTAs have a 44px mobile hit area', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const ctas = page.locator('.project-card:not(.project-card--featured) .text-link--card');
  await expect(ctas.first()).toHaveCSS('min-height', '44px');
});

test('large background motifs are unique by section', async ({ page }) => {
  await page.goto('/');
  const motifs = await page.locator('[data-section-motif]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-section-motif')));
  expect(new Set(motifs).size).toBe(motifs.length);
});
```

- [x] **Step 2: Run the focused tests** with `npx playwright test tests/quality.spec.ts --grep "44px|motifs"` and confirm the assertions fail because the current CSS/markup does not yet provide the new contract.

### Task 2: Implement the Marea Técnica section system

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/page.tsx` only when section motif data attributes are needed.

**Interfaces:**
- Consumes: section classes already present on the landing page.
- Produces: unique `data-section-motif` values and section-scoped pseudo-element treatments.

- [x] **Step 1: Keep the project orbit as the sole large-ring content motif** and remove the large-ring pseudo-elements from proof, services, process, about and contact.
- [x] **Step 2: Add scoped motifs:** proof bathymetry, construction datum ticks, services hydraulic plan/flow corner, process route accents, about elliptical ripples and contact coordinate brackets.
- [x] **Step 3: Keep each ambient layer below content z-index, set `pointer-events: none`, and constrain any oversized graphic with `overflow: hidden` already provided by the section.
- [x] **Step 4: Add reduced-motion rules for every new ambient animation and keep the page usable with animations disabled.
- [x] **Step 5: Run `npm run lint` and the focused visual tests.

### Task 3: Refine project cards and controls responsively

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/ProjectShowcase.tsx` only if the card needs a stable data attribute.

**Interfaces:**
- Consumes: existing featured/secondary card variants and `.text-link--card` contract.
- Produces: stable secondary-card layout at mobile/tablet/desktop and consistent control hierarchy.

- [x] **Step 1: Set secondary card mobile CTAs to `min-height: 44px`, align their content, and preserve dark text on light surfaces.
- [x] **Step 2: Bound secondary title and summary rhythm without clipping essential text; use layout-safe spacing instead of fixed heights where content varies.
- [x] **Step 3: Add a tablet-specific rule around 1024px so the narrow secondary card does not create an awkward 57px wrapped CTA.
- [x] **Step 4: Normalize primary, secondary and editorial-link focus/hover/active states and keep touch targets usable.
- [x] **Step 5: Run `npx playwright test tests/quality.spec.ts --grep "44px|overflow|secondary"` and confirm the new tests pass.

### Task 4: Polish motion and visual details without adding dependencies

**Files:**
- Modify: `src/app/globals.css`
- Modify: existing client components only if a real state transition needs adjustment.

**Interfaces:**
- Consumes: current RevealObserver/Motion behavior and CSS variables.
- Produces: subtle motif movement, button arrow feedback and consistent reduced-motion fallback.

- [x] **Step 1: Add only low-amplitude, long-duration ambient motion to section motifs where it clarifies water/flow; do not animate layout dimensions.
- [x] **Step 2: Add consistent arrow translation and border/color transitions for interactive controls.
- [x] **Step 3: Extend the existing reduced-motion block so ambient and control transitions become immediate while opacity/readability remains intact.
- [x] **Step 4: Capture desktop and mobile screenshots for visual inspection and remove one unnecessary decorative detail if any section feels crowded.

### Task 5: Verify the acceptance matrix

**Files:**
- Modify: `tests/quality.spec.ts` only if a verified gap needs a precise regression assertion.

**Interfaces:**
- Consumes: completed visual implementation and existing quality suite.
- Produces: fresh evidence for the full acceptance matrix.

- [x] **Step 1: Run `npm run lint`.
- [x] **Step 2: Run `npm run test:content`.
- [x] **Step 3: Run `npm run test:e2e` and confirm all functional, responsive, console and Axe checks pass.
- [x] **Step 4: Run `npm run build`.
- [x] **Step 5: Review `git diff --check`, `git status --short`, changed-file scope and the final visual matrix at 320/390/768/1024/1280/1440px.
- [x] **Step 6: Report exact command outputs, changed files, remaining risks and any follow-up opportunities without committing or merging.

## Verification evidence

- Focused TDD red baseline: 3 expected failures before implementation.
- Focused GREEN verification: 3 passed after implementation.
- Full browser contract: 18 passed, including Axe and console checks.
- Content contract: passed.
- Lint: passed.
- Production build: passed; `/` remains 54.2 kB and 157 kB First Load JS.
- Bundle analysis: generated client, edge and node reports successfully.
- Dependency audit: 0 vulnerabilities at the moderate threshold.
- Final development server: `npm run dev` responding at `http://localhost:3000`.
