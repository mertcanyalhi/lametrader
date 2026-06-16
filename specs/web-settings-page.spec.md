# Spec: web settings page

- Status: draft
- Touches:
  - `web` — the driving adapter only.
    Adds the `/settings` page (a real form bound to `GET`/`PUT /config`), a thin `useConfig` / `useUpdateConfig` query layer over the existing `apiFetch` + `QueryClient`, a `parseConfig`-backed react-hook-form resolver, the `sonner` toast surface, and a `Toaster` mounted in `AppShell`.
  - `core` — **no changes**.
    `parseConfig` / `Period` / `ConfigError` already enforce the rules and are reused verbatim.
  - `api` — **no changes**.
    The existing `GET`/`PUT /config` controller (`packages/api/src/controllers/config.controller.ts`) is the contract.

## Goal

Replace the boilerplate `/settings` placeholder with a real form that reads the platform config (`{ periods, defaultPeriod }`) from `GET /config` and writes it back via `PUT /config`.
Validation reuses `@lametrader/core`'s `parseConfig` directly through a custom react-hook-form resolver — the same module the backend uses — so no rule is duplicated.

## Locked decisions (carried over from the brainstorm)

- **Periods control** → Radix Primitives `@radix-ui/react-toggle-group` (multi-select), used directly with Tailwind classes inline.
  Compact trading-platform timeframe-bar visual: `1m 5m 15m 30m 1h 4h 1d 1w`.
- **`defaultPeriod` control** → Radix Themes `Select`.
  Options listed are the **currently-enabled** periods only.
  Toggling a period off in the timeframe bar removes it from the dropdown's options and clears `defaultPeriod` if it was the one removed — mirrors the domain rule client-side for instant feedback.
- **Save button** → Radix Themes `Button`; disabled until the form is dirty.
- **Success** → `sonner` toast (`toast.success('Settings saved')`).
  `<Toaster />` mounted once in `AppShell`.
- **Server-side errors** (`{ error: string }` 4xx) → Radix Themes `Callout color="red"` rendered inline above the form footer.
- **Loading + load-error states** → Radix Themes `Skeleton` rows for loading; `Callout color="red"` for a failed `GET /config`.
  Both are dedicated components, not raw text strings.
- **Validation** → A `parseConfigResolver` adapter mapping a thrown `ConfigError` to RHF's form-level error.
  No zod.
- **`useConfig` / `useUpdateConfig`** → live in `lib/hooks/use-config.ts`.
  `useUpdateConfig` invalidates the `['config']` query on success and writes the response straight into the cache (`setQueryData`).
- **Pino logger scope** → `'settings-page'` for form/save lifecycle events; the existing `'api-fetch'` and `'query-client'` scopes still log the underlying HTTP/query events.
- **No new shadcn-style wrappers under `src/components/ui/*`** — the rule from `packages/web/CLAUDE.md` (added in #45) holds: use Radix Themes / Radix Primitives directly with Tailwind classes inline.

## Acceptance criteria

`SettingsPage` rendering (`@testing-library/react` + jsdom + mocked `fetch`):

- [ ] On mount, the page calls `GET /api/config` and populates the form: the timeframe bar shows each `Period` from the response with the active ones pressed (`aria-pressed="true"`); the `defaultPeriod` select shows the response's `defaultPeriod`.
- [ ] While the initial `GET /api/config` is pending, the page renders a `Skeleton` placeholder — not raw text — and no form controls are interactive.
- [ ] When the initial `GET /api/config` fails (e.g. 500), the page renders an inline `Callout color="red"` with the server message; the form is not rendered.
- [ ] The "Save" button is disabled until the form is dirty (a period toggled or `defaultPeriod` changed).
- [ ] After a successful save the form re-baselines to the persisted config, so "Save" disables again until the next edit (it does not stay enabled against the originally-loaded values).
- [ ] Toggling an active period off in the bar (a) un-presses its button, (b) removes it from the `defaultPeriod` dropdown's options, and (c) **clears** `defaultPeriod` when the toggled-off period equalled the current default — mirroring the domain's `defaultPeriod ∈ periods` rule for instant client feedback.
- [ ] Submitting the form calls `PUT /api/config` with `{ periods, defaultPeriod }` matching the form state; on a 200 response, the success toast surfaces and the TanStack Query cache for `['config']` is updated to the response payload.
- [ ] A submit that the **client-side resolver** rejects (e.g. empty `periods`, `defaultPeriod` cleared) renders a form-level inline error from the thrown `ConfigError` and does **not** call `PUT`.
- [ ] A submit the server rejects with a 400 `{ error: '…' }` renders the server's `error` string inline as the form-level error; the cached config remains the previously-loaded value (the rejected payload is not optimistically applied).

`useConfig` / `useUpdateConfig` (jsdom, fake `fetch`):

- [ ] `useConfig` issues `GET /api/config` and returns `{ data: <Config> }` on success.
- [ ] `useUpdateConfig().mutateAsync(<Config>)` issues `PUT /api/config` with the JSON body and updates the cache for `['config']` to the response on success.

`parseConfigResolver` (pure):

- [ ] A valid `{ periods, defaultPeriod }` produces RHF's success shape (`{ values: <Config>, errors: {} }`).
- [ ] An invalid input (e.g. `periods: []`) produces an RHF error shape carrying the `ConfigError.message` as the root error.

## End-to-end expectation

API-side e2e — driving the same Fastify app the browser hits, asserting the surface the page binds to is what the spec promises.
Real Mongo (Testcontainers); covers the page's full happy path at the HTTP boundary and its one critical failure mode:

- Happy path: `GET /config` returns the default; `PUT /config` with `{ periods: ['1m','5m','1h','1d'], defaultPeriod: '1h' }` returns 200 with that payload; a subsequent `GET /config` returns it.
- Critical failure mode: `PUT /config` with `{ periods: [], defaultPeriod: '1d' }` returns **400** with `{ error: 'periods must not be empty' }`; a follow-up `GET /config` still returns the previous (pre-rejected) value.

There is no end-to-end test driving a real browser against the page — we don't have a Playwright harness, and the component-level jsdom tests already pin every observable behaviour above.

## Out of scope

- A `PATCH /config` partial-update flow (the page does full-replace `PUT`).
- Theme appearance controls (the dark/light toggle lives in the topbar from #33).
- Exposing the env runtime `Settings` (Mongo URI, ports, poll intervals) — not a REST resource.
- A page-level confirmation dialog before save / for destructive changes.
- An audit log of past saves.
- An i18n layer.

## Surprises

- **RHF v7 silently ignores resolver-returned `errors.root`.**
  A `setError('root', ...)` call populates `formState.errors.root`, but a resolver that returns `{ values: {}, errors: { root: ... } }` is treated as having no errors — `handleSubmit` calls the submit handler anyway.
  Fix: the resolver attaches `parseConfig` failures to `errors.periods` (a real field of `Config`); RHF then aborts the submit as expected.
  The UI reads the message from either `errors.periods` (resolver path) or `errors.root` (the submit handler's `setError` for server-side failures), so the form-level Callout shows the same message in either case.
  Documented inline in `packages/web/src/lib/parse-config-resolver.ts`.
- **React 19 + RTL + Vitest** needs `globalThis.IS_REACT_ACT_ENVIRONMENT = true` set before tests run.
  Without it, `userEvent.click` doesn't flush state updates synchronously and tests see stale form values.
  Set in `packages/web/src/test-setup.ts` (loaded via the root `vitest.config.ts` setup file).
- **Radix Themes' `Select` uses an internal `ScrollArea`** which reads `ResizeObserver`.
  jsdom doesn't ship one — a no-op polyfill in `test-setup.ts` lets the dropdown mount in component tests.
