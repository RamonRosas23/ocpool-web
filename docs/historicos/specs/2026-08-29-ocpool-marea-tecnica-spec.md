# OCPOOL Marea Técnica Visual Specification

**Date:** 2026-08-29  
**Status:** Implemented and verified  
**Scope:** Visual refinement pass after the premium-quality foundation

## Goal

Refine the existing OCPOOL landing page so every section has a distinct visual role, project cards remain clear on every device, and controls feel deliberately designed without adding heavy runtime dependencies.

## Design direction

The visual language is **Marea técnica**: architectural precision, hydraulic drawings and water movement. The large circular ring remains only as the projects section signature. Other sections use different low-contrast technical motifs tied to their content.

## Section treatments

- Manifesto/proof: fine bathymetric diagonal lines.
- Projects: one orbital ring plus restrained vertical datum lines.
- Construction: vertical measurement datum with small ticks.
- Services: hydraulic plan grid and an L-shaped flow/corner marker; no large ring.
- Process: the existing process timeline remains the main graphic; use route/connector accents instead of a ring.
- About: offset elliptical ripple bands; no perfect circle.
- Contact: coordinate/crosshair brackets; no large circle.
- Footer: a quiet horizon/technical rule, visually distinct from content sections.

## Component rules

- Secondary project cards stay one column below the mobile breakpoint and preserve the media-then-information reading order.
- Secondary card summaries are always readable on touch devices and limited to a stable visual length.
- Project card CTAs use dark text on light surfaces and have a mobile hit area of at least 44px.
- All buttons and links keep visible keyboard focus, clear hover/active states, and arrow motion limited to a short translate.
- Do not use text clipping for essential project titles or actions.
- Decorative layers remain pointer-events-free and must not create overflow.

## Motion and performance

- Reuse the existing Motion integration for stateful UI only.
- Use CSS for ambient motif movement and microinteractions.
- Disable non-essential animation under `prefers-reduced-motion: reduce`.
- Do not add GSAP, Lenis, a 3D renderer, or another animation runtime.
- Keep the existing image pipeline and avoid replacing original photography.

## Acceptance criteria

- No horizontal overflow at 320, 360, 390, 430, 768, 1024, 1280 and 1440 CSS pixels.
- Secondary project card buttons are readable, have at least 44px touch height on mobile, and do not wrap awkwardly at 1024px.
- No large circular background motif is reused in more than one non-footer content section.
- Each section has one identifiable decorative treatment and no more than two ambient pseudo-element layers.
- Body text and controls meet WCAG AA contrast targets; `:focus-visible` remains obvious.
- Reduced-motion mode contains no non-essential transform/animation transitions.
- Existing functional, SEO, accessibility, console, lint, content and build tests remain green.
- The production route size does not regress materially; no new heavy dependency is added.
