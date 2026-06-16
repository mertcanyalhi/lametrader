# @lametrader/web

Driving adapter — the browser app.
Builds via Vite; type-checks via `tsc --noEmit`; not part of the project-refs graph.

## Stack (locked)

- **React 19 + TypeScript + Vite** — already in place.
- **Tailwind CSS v4** via `@tailwindcss/vite`. Tokens live in `src/index.css` under `@theme inline`; **never** add a `tailwind.config.js`.
- **shadcn/ui pattern** — `@radix-ui/react-*` primitives with hand-authored thin wrappers under `src/components/ui/*`.
  Compose `class-variance-authority` with `cn(...)` (clsx + tailwind-merge) so callers can override individual classes without losing the variant defaults.
- **React Router v7** (`react-router`) for routing.
  Tests use `<MemoryRouter>`.
- **TanStack Query** (`@tanstack/react-query`) for server state.
  No `useState`-and-`useEffect` data fetching, no global stores, no manual cache logic.
- **lucide-react** for icons.

## UI/UX rules

These are the rules every PR is held to.

### Use the framework primitive, never the native equivalent

- Hover label → `<SimpleTooltip>` (Radix). **Never** `title="…"` on any element.
- Confirmation prompt → `<AlertDialog>` (Radix). **Never** `window.confirm()`.
- Text prompt → `<Dialog>` with a form. **Never** `window.prompt()`.
- Notifications → a toast component. **Never** `window.alert()`.
- Select dropdown → `<Select>` (Radix). **Never** a bare `<select>`.
- Combobox / autocomplete → `<Combobox>` (Radix). **Never** a `datalist`.
- Tabbed views → `<Tabs>` (Radix). **Never** ad-hoc `useState + classNames`.
- Floating panel → `<Popover>` (Radix). **Never** an absolutely-positioned `<div>` you toggle yourself.

When a new primitive is needed for an issue, hand-author it under `src/components/ui/<name>.tsx` on top of the Radix piece (same shape as `button.tsx`, `tooltip.tsx`).

### Layout

- The app is a **trading-platform-style shell**: a persistent left sidebar (primary nav) plus a topbar across the top, every page rendered inside `<main>`.
- The shell (`<AppShell>`) owns the shared providers (`<TooltipProvider>`).
- Below 1024 px, the sidebar collapses to an icon rail (Tailwind `lg:` breakpoint, CSS-only).
- Page content is a **card on `bg-card`** by default — see `<PagePlaceholder>`.

### Theme

- Dark by default; the `dark` class on `<html>` drives Tailwind's `dark:` variants.
- The choice is persisted to `localStorage.theme` (`'light'` | `'dark'`) and applied via an inline `<script>` in `index.html` before React paints, so there is no light-flash on load.
- All colours are theme tokens (`bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`, `bg-accent`, `bg-card`, `text-popover-foreground`, …) — **never** hard-coded `bg-zinc-900` / `text-white` / `#fff`.

### Accessibility

- Icon-only buttons get a real accessible name via `aria-label` **and** a visible label via `<SimpleTooltip>`.
  A tooltip alone is a description, not a name.
- Active nav links: `react-router`'s `<NavLink>` sets `aria-current="page"` automatically — read it in tests, don't reach for a CSS class.

### Data

- Server state through TanStack Query (`useQuery` / `useMutation`).
- All HTTP calls go through `lib/api-fetch.ts` (`apiFetch<T>(path, init?)`).
  Paths are relative to `/api` — never hardcode `http://localhost:3000` or include the protocol/host.
- WebSocket clients live in `lib/*` and are exposed through hooks (`useStream*`); **never** `new WebSocket(...)` directly in a component.
- Never read or write `localStorage` directly in a component — wrap each concern in a `lib/*` module so behaviour is reusable and testable (see `lib/theme.ts`).

### Forms

- Validate at the boundary by parsing the form payload through the corresponding `@lametrader/core` parser (`parseConfig`, `parseProfileFields`, …).
  No client-side validation duplicates: the domain validator is the single source of truth.
- For complex forms, use `react-hook-form` with a custom resolver that wraps the core parser.

### Tests

- Component tests sit beside the code as `*.test.tsx` and start with `// @vitest-environment jsdom`.
- Render with `@testing-library/react`; wrap in `<MemoryRouter>` when the component reads route state.
- Call `cleanup()` in `afterEach` (auto-cleanup is off because we don't use Vitest globals).
- Query by **role + accessible name** (`getByRole('button', { name: 'Toggle theme' })`).
  Never query by class or test-id unless there is truly no semantic anchor.
- Assert the FULL payload with `toEqual` — never `toMatchObject` or per-field assertions.

### Naming / layout

- Files: `kebab-case.tsx` for components, `kebab-case.ts` for utilities, `*.types.ts` for type-only modules.
- Components: `PascalCase`.
- One component per file when it's exported; tiny internal helpers can live alongside.
- Folder structure:
  - `src/components/ui/*` — design-system primitives (Button, Tooltip, …).
  - `src/components/layout/*` — shell pieces (AppShell, Sidebar, Topbar).
  - `src/pages/*` — one file per route.
  - `src/lib/*` — non-component utilities (api-fetch, query-client, theme, …).
  - `src/features/<name>/*` — feature-local hooks / components, when the feature outgrows `pages/`.

## Build & dev

- `npm run dev -w @lametrader/web` — Vite dev server.
- `npm run build -w @lametrader/web` — production build into `packages/web/dist`.
- `npm run typecheck -w @lametrader/web` — `tsc --noEmit` (picked up by the root `typecheck`).
- Unit tests run under the root `npm test` because vitest's unit project includes `packages/**/src/**/*.test.{ts,tsx}`.

## Out of scope (for now)

- Mobile (`<Sheet>` drawer, hamburger nav) — desktop-first; mobile lands later.
- A visual-regression harness (Playwright / Storybook).
- An i18n layer — the app is English-only for now.
