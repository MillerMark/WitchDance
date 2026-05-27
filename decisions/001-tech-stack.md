# Decision 001: Tech Stack

**Date:** 2026-05-23
**Author:** Ione Vale

## Decision
Vite + React + TypeScript + vite-plugin-pwa

## Rationale
- Vite provides fast HMR and lean production builds suitable for static hosting (Netlify/Vercel)
- React functional components + hooks maps naturally to the three-screen state machine (picker → builder → playback)
- TypeScript catches audio scheduling errors at compile time — especially important for the timing-sensitive crossfade engine
- vite-plugin-pwa handles service worker and manifest generation, enabling iPhone home screen installation

## Alternatives considered
- Vanilla JS + Web Components: simpler, but state management across three screens becomes error-prone without a framework
- Next.js: overkill — no SSR needed, static export adds unnecessary complexity

## Status
Accepted
