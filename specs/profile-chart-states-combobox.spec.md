# Spec: profile chart-states combobox

- Status: draft
- Touches:
  - `web` — new `pages/chart/chart-states-picker.tsx` (the multi-select chips combobox); `pages/chart/profile-picker-dialog.tsx` (renders the control in the create/edit form, threads the current chart symbol, sends `chartStates` on edit-`PATCH`); `lib/hooks/profiles.ts` (`UpdateProfileInput.patch` widens to carry `chartStates`); `lib/hooks/state.ts` (`useSymbolStateKeys` disabled when the symbol id is empty); `pages/chart/chart-page.tsx` (passes the chart symbol to the picker).

## Goal

Give the profile create/edit form a **Chart states** control — a chips-style combobox that multi-selects the symbol-state keys whose markers the chart renders for the profile, binding to the `chartStates` field that landed (data-path only) in the blocker slice.
Suggested options come from the current chart symbol's known state keys (`useSymbolStateKeys`); a user can also type an arbitrary key that isn't suggested and it is accepted as-is.
Opened away from a chart (no symbol in context) the suggestion list is empty and free-text entry still works.

The control is built on the already-installed `react-select/creatable` in `isMulti` mode, re-skinned via the shared `lib/select-skin` (the same shell as `StateKeyPicker` / `ScopePicker`), so no new dependency and no bespoke tag-input.

## Acceptance criteria

Each bullet maps to exactly one test.

`ChartStatesPicker` (`pages/chart/chart-states-picker.tsx`):

- [ ] Selecting a suggested option from the menu adds it as a chip — `onChange` fires with the prior value plus the picked key (full-payload).
- [ ] Removing a chip via its remove control fires `onChange` with that key dropped (full-payload).
- [ ] Typing a value absent from the suggestions and confirming it with `Enter` adds it as a chip — `onChange` fires with the free-text key appended (full-payload).
- [ ] The menu lists exactly the provided option keys as `option` roles (options sourced from the passed state keys).
- [ ] With an empty options list, typing a value and confirming it still adds it as a chip (free-text-only fallback) — `onChange` fires with just that key (full-payload).

Profile form (`pages/chart/profile-picker-dialog.tsx`):

- [ ] The create/edit form renders a **Chart states** section: the `Chart states` label, an info affordance carrying "States to be rendered in the chart.", and one multi-select `combobox` bound to `chartStates`.
- [ ] The control is initialised from the loaded profile's `chartStates` (its chips show the stored keys) and an edit submit sends them through `PATCH /profiles/:id` (the patch body now carries `chartStates`).

Hook guard (`lib/hooks/state.ts`):

- [ ] `useSymbolStateKeys('')` is disabled and issues no request (so the form opened away from a chart seeds empty options without a bogus `GET /symbols//state-keys`).

## End-to-end expectation

No new e2e tier: like the sibling `operand-state-key-combobox` slice, every criterion is verifiable at the jsdom component / form-integration level, and the parent feature's chart-marker consumption e2e lands in the integration slice.
The web build-artifact e2e (`rules-ui.e2e.test.ts` / `build.e2e.test.ts`) continues to pass unmodified.

Happy path (component + form integration): open the edit form for a profile carrying `chartStates: ['price:trend']` → the control shows a `price:trend` chip → pick a suggested `rsi:zone` and type-add a free-text `custom:key` → submit → `PATCH` body carries `chartStates: ['price:trend', 'rsi:zone', 'custom:key']`.

Critical failure mode: open the create form away from a chart (no symbol) → the suggestion menu is empty (no `GET /symbols//state-keys` fires) yet a typed `custom:key` still adds a chip and is sent on create.

## Out of scope

- The chart-side consumption that reads `chartStates` to render only the listed states' markers — the integration slice.
- Any `core` / `api` / `engine` change — the field, its validators, persistence and echo already landed in the blocker slice.
- A generic reusable tag-input abstraction — this is the first multi-select-creatable; keep it a concrete control alongside the existing `StateKeyPicker` / `ScopePicker`.
- Restyling or changing the shared `select-skin`.

## Surprises

(filled in retroactively)
