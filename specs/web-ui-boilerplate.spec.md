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

- **Design system**: Radix UI primitives (`@radix-ui/react-tooltip`, …), wrapped under `src/components/ui/*` *only when there is a Radix primitive underneath* (we wrap to add our theme tokens, not to invent components).
  Plain HTML elements like `<button>`, `<input>`, `<a>` are used natively at the call site with Tailwind classes — no hand-rolled wrappers.
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite`, CSS-first tokens under `@theme` in `src/index.css`, no `tailwind.config.js`.
- **Routing**: React Router v7 (`createBrowserRouter` or `<BrowserRouter>` + `<Routes>` — driven adapter decides; tests use `<MemoryRouter>`).
- **Server state**: `@tanstack/react-query` with a shared `QueryClient`; `apiFetch` wraps `fetch` against `/api/*`.
- **Icons**: `lucide-react`.
- **Theme**: dark by default; `localStorage.theme` (`'light'` | `'dark'`) overrides.
  Hydrated via an inline `<head>` script so there is no light-flash before React mounts.
- **Icon-only theme toggle a11y**: visible label rendered through `<Tooltip>` on hover/focus; accessible name supplied by `aria-label="Toggle theme"`.
  Never `title=`.
- **CLAUDE.md location**: `packages/ui/CLAUDE.md` (scoped to the package; not appended to the root).
- **Sidebar collapsibility**: a hamburger button on the topbar's left edge toggles the sidebar between expanded (label + icon) and collapsed (icon rail) at ≥ 1024 px.
  Default state: expanded.
  The choice is persisted to `localStorage.sidebar-collapsed` (`'true'` | `'false'`).
  **Below 1024 px the CSS rules still force an icon rail regardless of the stored choice** (the manual toggle only widens above the breakpoint).
- **Topbar brand**: there is no visible app-name label in the topbar; the page `<title>` is the only place the brand text lives.
  The topbar's left edge holds the sidebar-toggle button instead.
- **Vitest config**: `packages/**/src/**/*.test.{ts,tsx}` for the unit project so the smoke test (`App.test.tsx`) is picked up.
  No new project / no node-vs-DOM split — jsdom is enabled per-file via `// @vitest-environment jsdom`.

## Acceptance criteria

Routing + shell (unit, `@testing-library/react` + jsdom + `<MemoryRouter>`):

- [ ] At `/`, the watchlist placeholder card renders inside the shell ("Watchlist" heading).
- [ ] At `/chart`, the chart placeholder card renders inside the shell ("Chart" heading).
- [ ] At `/settings`, the settings placeholder card renders inside the shell ("Settings" heading).
- [ ] The sidebar nav link for the current route carries `aria-current="page"`; the other two do not.

Topbar + sidebar toggle + theme toggle (unit, `@testing-library/react` + jsdom):

- [ ] The topbar's theme-toggle button exposes accessible name "Toggle theme" via `aria-label` (its `title` attribute is absent — the visible label comes from `<Tooltip>`, not `title=`).
- [ ] The topbar holds a sidebar-toggle button with accessible name "Toggle sidebar" (no `title=`).
- [ ] The sidebar boots expanded by default (`data-collapsed="false"`).
- [ ] Clicking the topbar sidebar-toggle collapses the sidebar (`data-collapsed="true"`) and writes `'true'` to `localStorage.sidebar-collapsed`.
- [ ] When `localStorage.sidebar-collapsed === 'true'` on boot, the sidebar starts collapsed.

Sidebar persistence module (unit, jsdom — `getStoredSidebarCollapsed` / `setSidebarCollapsed` over `window.localStorage`):

- [ ] `getStoredSidebarCollapsed()` returns `false` when `localStorage.sidebar-collapsed` is unset.
- [ ] `getStoredSidebarCollapsed()` returns `true` when `localStorage.sidebar-collapsed === 'true'`.
- [ ] `setSidebarCollapsed(true)` writes `'true'` to `localStorage.sidebar-collapsed`.
- [ ] `setSidebarCollapsed(false)` writes `'false'` to `localStorage.sidebar-collapsed`.

Theme module (unit, jsdom — `applyInitialTheme` / `setTheme` over `document.documentElement` + `window.localStorage`):

- [ ] `applyInitialTheme()` with no `localStorage.theme` sets the `dark` class on `<html>` (dark-by-default).
- [ ] `applyInitialTheme()` with `localStorage.theme === 'light'` removes the `dark` class.
- [ ] `setTheme('light')` removes the `dark` class and writes `localStorage.theme = 'light'`.
- [ ] `setTheme('dark')` adds the `dark` class and writes `localStorage.theme = 'dark'`.

Documentation:

- [ ] `packages/ui/CLAUDE.md` exists and documents the UI/UX rules (popover/dialog/etc. over native, dark default + light toggle, server-state via TanStack Query, no `new WebSocket(...)` in components, conventions for forms / tests / layout / naming).

## End-to-end expectation

E2E for a web feature is a real `vite build` against the package, asserting the deployable artifact is what we ship.
No browser harness (Playwright) is in scope for this issue.

- Happy path: `vite build` over `packages/ui` exits 0; `packages/ui/dist/index.html` exists, carries the app shell (the `<title>lametrader</title>` and the `#root` mount, i.e. this app's template rather than a scaffold), and references a hashed JS bundle under `assets/`; that bundle file exists on disk and is substantial (the real app, not a failed or empty build).
  These are deterministic artifact properties. The e2e deliberately does **not** grep the minified bundle for a rendered source string: rolldown emits minified output differently across machines (a "Watchlist" marker was present locally but absent from CI on identical versions), so a bundle string-grep is not a reliable assertion. That the shell renders its content is covered deterministically in jsdom by `packages/ui/src/App.test.tsx`.

There is no orthogonal failure mode worth a second test here — the build either produces a clean artifact or fails on import, which the happy path already detects.

## Out of scope

- Real page content (watchlist list, chart canvas, settings form) — separate issues.
- The shared `/stream` WebSocket client and any live data — separate issues.
- A `<Sheet>` drawer for mobile.
- More UI primitives (`Dialog`, `Popover`, `Select`, `Table`, …) — added by the page issues that first need them.
- Visual regression / Playwright e2e.

## Surprises

(Filled in after implementation if anything didn't go as expected.)
