# Spec: web profile picker (chart bottom-bar)

- Status: draft
- Touches: `@lametrader/ui` driving adapter — new `lib/selected-profile.ts` (localStorage), new `lib/selected-profile-context.tsx` (React Context), new `lib/hooks/profiles.ts` (TanStack Query over `GET/POST/PUT/DELETE /profiles`), new `pages/chart/profile-picker-dialog.tsx`, modifications to `pages/chart/chart-page.tsx` to mount the picker, and `components/layout/app-shell.tsx` to provide the Context.
  Reads the existing REST surface (`/profiles`, `/profiles/:id` from `profile-crud`).
  No backend change.

## Goal

Introduce the **currently selected profile** as a global concept in the web app and the UI to manage it: a profile trigger in the chart's bottom bar (alongside the symbol picker and period+range dialog) that opens a **single modal where the user both selects a profile and manages them (create / edit / delete)**.
The selected profile id is persisted to `localStorage` so the choice survives reloads — and is **deliberately not** reflected in the URL.
This delivers only the container; the consumer that reads the selection (chart indicator overlays) is a separate task.

## Domain / application model

Reuses `@lametrader/core`'s `Profile`, `ProfileFields`, `ProfileScopeSpec`, `ProfileScope` — no web-side redeclaration.

The picker's create/edit form edits **`name`, `description`, `enabled`** only.
On create, `POST /profiles` is sent with `{ name, description, enabled, scope: { type: 'all' } }` (the server's same default).
On edit, the page sends `PATCH /profiles/:id` with only the three editable fields — `PATCH` preserves `scope` and `indicators` server-side, so the form never has to know about them and any existing `Symbols`-scoped subset survives untouched.
A `409` (duplicate name) is surfaced inline under the name field.

## Persistence model

- Storage key: `lametrader.selectedProfileId` (string id, or absent when nothing is selected).
- All access is wrapped in `lib/selected-profile.ts` (`getStoredProfileId() / setStoredProfileId(id | null)`) per `packages/ui/CLAUDE.md`'s "never read/write `localStorage` directly in a component" rule.
- `SelectedProfileProvider` hydrates the initial value from `getStoredProfileId()` once at mount; every `setProfileId` writes through synchronously.
- Passing `null` to `setProfileId` removes the key (don't store an empty string).
- A stored id that no longer exists in `GET /profiles` is treated as "No profile" — the picker does **not** auto-pick a fallback and does **not** wipe the stale value. It's overwritten the next time the user makes a selection (or stays as-is if the missing profile reappears later, e.g. recreated from another tab).
- First-run defaulting (auto-pick the first enabled profile) applies only when **no** id is stored at all — never when the stored id is just stale.

## URL model

The selected profile is **not** in the URL — selecting a profile must not mutate `location.search`, and any `?profile=` in an incoming URL is ignored.
This is a per-user preference, not a shareable view.

## Acceptance criteria

Each bullet maps to exactly one test.

### `lib/selected-profile.ts` (storage module)

- [ ] `setStoredProfileId('p-1')` then `getStoredProfileId()` returns `'p-1'` (round-trip through localStorage under the documented key).
- [ ] `getStoredProfileId()` returns `null` when no profile has been stored.
- [ ] `setStoredProfileId(null)` removes the key entirely (a subsequent `getStoredProfileId()` returns `null`, and `localStorage.getItem(key)` is `null`).

### `lib/selected-profile-context.tsx` (React Context)

- [ ] `useSelectedProfile()` returns the value hydrated from `getStoredProfileId()` on mount (when storage holds an id, the provider seeds the context with it).
- [ ] Calling `setProfileId(id)` updates the Context's `profileId` **and** writes through to `localStorage` via `setStoredProfileId`.

### `pages/chart/profile-picker-dialog.tsx` (the bottom-bar modal)

The dialog is the single surface for both selecting and managing profiles.
Tests mock `apiFetch` via the global `fetch` (same pattern as `symbol-picker-dialog.test.tsx`) and wrap in `<SelectedProfileProvider>` + `<QueryClientProvider>` + `<Theme>`.

- [ ] The trigger button is labeled with the active profile's name when one is selected.
- [ ] The trigger button reads `"No profile"` when no profile is selected.
- [ ] Opening the dialog lists every profile from `GET /profiles` as a row (each row's accessible name includes the profile name; disabled profiles render with a muted "disabled" hint).
- [ ] Clicking a profile row sets the global selection, closes the dialog, and writes the chosen id to `localStorage`.
- [ ] The "New profile…" entry opens a create form; submitting issues `POST /profiles` with `{ name, description, enabled, scope: { type: 'all' } }`; on success the new profile becomes the selection (and is written to `localStorage`), the picker closes, and a `toast.success` fires.
- [ ] A `409 { error }` from `POST /profiles` is surfaced inline under the name field; nothing is selected.
- [ ] Editing a profile sends `PATCH /profiles/:id` with only `{ name, description, enabled }` (never `scope` or `indicators`, so the server preserves both); the picker closes and `toast.success` fires.
- [ ] Deleting the selected profile issues `DELETE /profiles/:id`; selection falls back to the first remaining `enabled` profile and is written through to `localStorage`.
- [ ] Deleting the selected profile when no other enabled profile remains falls back to `"No profile"` and clears `localStorage`.
- [ ] Selecting a profile from the modal does **not** mutate `location.search` (no `?profile=` is added).

### `pages/chart/chart-page.tsx` integration

- [ ] The chart's bottom-bar `Flex aria-label="Chart actions"` hosts the profile-picker trigger after the symbol and period+range triggers (assert the trigger is reachable by its accessible name within the bottom bar).
- [ ] On chart load with profiles available and nothing stored, the trigger label is the first `enabled` profile's name (first-run default) and that id is persisted to `localStorage`.
- [ ] On chart load with a stored id that does not exist in `GET /profiles`, the trigger reads `"No profile"` and the stored value is left in `localStorage` (treated as stale without proactive wipe).

## End-to-end expectation

Per the chart-page spec's note, page-level behaviour for the web package is covered by the jsdom component tier (no browser e2e harness).
The existing `packages/ui/tests/e2e/build.e2e.test.ts` is the only `*.e2e.test.ts` for the package; it asserts `vite build` produces an artifact whose JS bundle contains a rendered marker string.

For this feature, the e2e tier adds **one bundle-marker assertion**: the built JS bundle contains the string `"Manage profiles"` (or `"No profile"` — whichever lands in the picker's static copy), confirming the profile-picker module is wired into the route tree and ships with the deployable artifact.
The build is shared with the existing markers via the same `beforeAll`.

Critical failure mode: `GET /profiles` failing on chart load — the trigger reads `"No profile"` and the rest of the chart page still renders (failure is contained to the picker; the candle chart is unaffected).
Asserted in the chart-page jsdom test by responding `500` for `/profiles`.

## Out of scope

- The indicator-overlay consumer that reads the selected profile (separate issue, includes the no-profile warning triangle).
- Editing a profile's `scope` (All vs Symbols subset) — the form is name/description/enabled only.
- Managing a profile's attached indicators (separate issue, uses the `/profiles/:id/indicators` sub-resource).
- A dedicated `/profiles` page or topbar profile selector (both deferred — selection lives in the chart bottom-bar modal for this issue).
- Putting the selected profile in the URL or shareable chart links (explicit non-goal).
- Cross-tab live sync via the `storage` event (hydration on mount is enough; deferred until a user actually flips profiles across tabs mid-session).

## Surprises

(filled in retroactively)
