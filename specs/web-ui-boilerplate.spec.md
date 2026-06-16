# Spec: web UI boilerplate

- Status: draft
- Touches:
  - `web` — the driving adapter only.
    Adds the persistent shell (sidebar + topbar), three placeholder routes (`/`, `/chart`, `/settings`), the first two design-system primitives (`Button`, `Tooltip`), the theme (`dark` default, `light` toggle, `localStorage`-persisted), the `apiFetch` + `QueryClient` data layer, and the per-package `CLAUDE.md` documenting the UI/UX rules.
  - Root `vitest.config.ts` — extend the unit `include` from `*.test.ts` to `*.test.{ts,tsx}` so component tests live beside the code.
  - No domain, port, or driven-adapter changes.

## Goal

Stand up the foundation every later UI task builds on: a trading-platform-style shell that every page renders inside, the design-system primitive pattern (shadcn/ui-style — Radix UI + hand-authored wrappers), client-side routing (React Router v7), server-state plumbing (TanStack Query + a typed `apiFetch` over the nginx `/api/*` proxy), both dark and light themes with a topbar toggle, and the per-package CLAUDE.md.
Page bodies are intentionally placeholder — subsequent issues fill in real content.

## Locked decisions (carried over from the planning brainstorm — surfaced here for the record)

- **Design system**: shadcn/ui pattern over Radix UI primitives (`@radix-ui/react-tooltip`, …), hand-authored thin wrappers in `src/components/ui/*`.
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite`, CSS-first tokens under `@theme` in `src/index.css`, no `tailwind.config.js`.
- **Routing**: React Router v7 (`createBrowserRouter` or `<BrowserRouter>` + `<Routes>` — driven adapter decides; tests use `<MemoryRouter>`).
- **Server state**: `@tanstack/react-query` with a shared `QueryClient`; `apiFetch` wraps `fetch` against `/api/*`.
- **Icons**: `lucide-react`.
- **Theme**: dark by default; `localStorage.theme` (`'light'` | `'dark'`) overrides.
  Hydrated via an inline `<head>` script so there is no light-flash before React mounts.
- **Icon-only theme toggle a11y**: visible label rendered through `<Tooltip>` on hover/focus; accessible name supplied by `aria-label="Toggle theme"`.
  Never `title=`.
- **CLAUDE.md location**: `packages/web/CLAUDE.md` (scoped to the package; not appended to the root).
- **Sidebar at narrow widths**: CSS-driven collapse to icon rail below 1024 px (Tailwind `lg:` breakpoint).
  Not unit-tested (CSS-only); covered by manual visual review.
- **Vitest config**: `packages/**/src/**/*.test.{ts,tsx}` for the unit project so the smoke test (`App.test.tsx`) is picked up.
  No new project / no node-vs-DOM split — jsdom is enabled per-file via `// @vitest-environment jsdom`.

## Acceptance criteria

Routing + shell (unit, `@testing-library/react` + jsdom + `<MemoryRouter>`):

- [ ] At `/`, the watchlist placeholder card renders inside the shell ("Watchlist" heading).
- [ ] At `/chart`, the chart placeholder card renders inside the shell ("Chart" heading).
- [ ] At `/settings`, the settings placeholder card renders inside the shell ("Settings" heading).
- [ ] The sidebar nav link for the current route carries `aria-current="page"`; the other two do not.

Topbar + theme toggle (unit, `@testing-library/react` + jsdom):

- [ ] The topbar shows the brand text "lametrader".
- [ ] The topbar's theme-toggle button exposes accessible name "Toggle theme" via `aria-label` (its `title` attribute is absent — the visible label comes from `<Tooltip>`, not `title=`).

Theme module (unit, jsdom — `applyInitialTheme` / `setTheme` over `document.documentElement` + `window.localStorage`):

- [ ] `applyInitialTheme()` with no `localStorage.theme` sets the `dark` class on `<html>` (dark-by-default).
- [ ] `applyInitialTheme()` with `localStorage.theme === 'light'` removes the `dark` class.
- [ ] `setTheme('light')` removes the `dark` class and writes `localStorage.theme = 'light'`.
- [ ] `setTheme('dark')` adds the `dark` class and writes `localStorage.theme = 'dark'`.

Documentation:

- [ ] `packages/web/CLAUDE.md` exists and documents the UI/UX rules (popover/dialog/etc. over native, dark default + light toggle, server-state via TanStack Query, no `new WebSocket(...)` in components, conventions for forms / tests / layout / naming).

## End-to-end expectation

E2E for a web feature is a real `vite build` against the package, asserting the deployable artifact is what we ship.
No browser harness (Playwright) is in scope for this issue.

- Happy path: `vite build` over `packages/web` exits 0; `packages/web/dist/index.html` exists and references at least one JS bundle under `assets/`; that bundle file exists on disk; the bundle contents include the brand string "lametrader" (the shell rendered into the bundle).

There is no orthogonal failure mode worth a second test here — the build either produces a clean artifact or fails on import, which the happy path already detects.

## Out of scope

- Real page content (watchlist list, chart canvas, settings form) — separate issues.
- The shared `/stream` WebSocket client and any live data — separate issues.
- A `<Sheet>` drawer for mobile.
- More UI primitives (`Dialog`, `Popover`, `Select`, `Table`, …) — added by the page issues that first need them.
- Visual regression / Playwright e2e.

## Surprises

(Filled in after implementation if anything didn't go as expected.)
