# OCPOOL Premium Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task by task, with verification after each meaningful change.

**Goal:** Implement the approved premium-quality hardening pass for the OCPOOL landing page: accessible interactions, SEO foundations, purposeful animation, reproducible QA, and measured production readiness.

**Architecture:** Preserve the existing Next App Router page and content model. Keep static content in `src/lib/pool-content.ts`, isolate browser behavior in existing client components, render global metadata/routes from App Router files, and use Playwright/Axe as the executable quality contract.

**Tech Stack:** Next.js 15 patch line, React 19, TypeScript, CSS, Motion for React, Playwright Test, Axe Playwright, Next bundle analyzer, npm.

**Spec:** `docs/historicos/specs/2026-08-29-ocpool-premium-quality-spec.md`

## Global constraints

- Keep the current checkout and preserve unrelated user work.
- Do not delete or overwrite original photographs.
- Do not add real lead data to tests.
- Do not claim completion without fresh lint, contract tests, E2E/Axe tests, and production build output.
- Use `apply_patch` for source/config/document edits.
- Work test-first for behavior changes: add a failing assertion, run it, implement the smallest coherent change, then re-run it.

## Tasks

### 1. Establish the executable QA contract

- [ ] Add the approved development/test dependencies and scripts/configuration.
- [ ] Add Playwright coverage for fixed-header anchor positioning, mobile menu dismissal/focus return, dialog focus trap/focus return, server-side consent rejection, SEO metadata/routes, no horizontal overflow, and console errors.
- [ ] Add Axe coverage for the initial page, mobile menu, and project dialog.
- [ ] Run the new tests before production behavior changes and record the expected failures as the red baseline.

### 2. Harden interaction behavior with TDD

- [ ] Add outside-click and Escape handling to the mobile navigation, with deterministic focus restoration.
- [ ] Move the project dialog to a document-level portal and implement a bounded focus trap, inert background semantics, scroll lock cleanup, and deterministic focus restoration.
- [ ] Fix anchor scroll offsets for the fixed header across breakpoints.
- [ ] Validate consent in `/api/send-email` and align client/server payload types and error states.
- [ ] Re-run focused tests until all interaction assertions pass.

### 3. Apply the premium motion and responsive polish

- [ ] Integrate Motion only where it improves stateful transitions and configure reduced-motion behavior.
- [ ] Keep CSS microinteractions and scroll-linked effects safe for reduced motion and non-supporting browsers.
- [ ] Make the mobile navigation surface opaque and refine the tablet breakpoint and focus states.
- [ ] Remove or correct accessibility-hidden instructional content and review labels/roles for interactive controls.

### 4. Complete SEO and semantic foundations

- [ ] Expand layout metadata with canonical, Open Graph, Twitter/X, and safe URL metadata.
- [ ] Add generated `robots.txt` and `sitemap.xml` using the canonical domain.
- [ ] Add JSON-LD based only on verified OCPOOL content already present in the repository.
- [ ] Verify metadata and endpoint assertions through Playwright.

### 5. Review image loading and bundle hygiene

- [ ] Inspect hero/project image priorities and remove avoidable duplicate eager work.
- [ ] Add an on-demand bundle analyzer script without enabling it in normal builds.
- [ ] Document the image and dependency decisions in the implementation notes.
- [ ] Confirm no original image files were removed and record asset/build metrics.

### 6. Full verification and handoff

- [ ] Run lint, content contract tests, E2E/Axe tests, production build, and a final git diff/status review.
- [ ] Confirm the acceptance matrix at 360/390/768/1440 px and no console errors.
- [ ] Update the plan with completed evidence and remaining follow-up opportunities.
- [ ] Use `superpowers:finishing-a-development-branch` to determine the clean handoff state; do not commit or merge unless explicitly requested.
