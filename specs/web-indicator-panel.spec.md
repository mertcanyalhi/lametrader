# Spec: web chart indicator panel (manage selected profile's indicators)

- Status: draft
- Touches: `@lametrader/web` driving adapter — new `lib/hooks/indicators.ts` (TanStack Query over `GET /indicators`, `GET/POST /profiles/:id/indicators`, `PUT/DELETE /profiles/:id/indicators/:instanceId`), new `pages/chart/indicators/indicator-panel-dialog.tsx` (the bottom-bar trigger + Dialog shell), `pages/chart/indicators/indicator-panel.tsx` (the list/empty body), `pages/chart/indicators/add-indicator-dialog.tsx` (two-step catalog → inputs nested dialog, also reused for edit), `pages/chart/indicators/indicator-inputs-form.tsx` (descriptor-driven form), `pages/chart/indicators/detach-indicator-dialog.tsx` (confirmation `AlertDialog`).
  Modifies `pages/chart/chart-page.tsx` to mount the trigger in the bottom-bar `Flex` and pass the current symbol's `type` for the n/a check.
  Reads the existing REST surface (`/indicators`, `/profiles/:id/indicators` sub-resource).
  No backend change.

## Goal

Let the user **manage which indicators are attached to the currently selected profile** from the chart page — list the profile's instances, add an indicator from the catalog with a descriptor-driven inputs form, edit an instance's inputs, and detach one.
The panel is opened from a new chart bottom-bar trigger (consistent with the symbol / period / profile dialogs already there); when no profile is selected, opening the panel shows a warning callout (`lucide TriangleAlert`) explaining how to fix it.
This issue delivers only the management surface — drawing overlays on the canvas + a chart legend is the follow-up "indicator overlays" task.

## Domain / application model

Reuses `@lametrader/core`'s `IndicatorDefinition`, `IndicatorInstance`, `FieldDescriptor` (Number / Source / Enum), `PriceSource`, `SymbolType`, plus the selected-profile context (`useSelectedProfile`) shipped with the picker.
No web-side redeclaration.

The panel reads:

- `useIndicatorCatalog()` → `GET /indicators` — array of every registered definition.
- `useProfileIndicators(profileId)` → `GET /profiles/:id/indicators` — embedded instances on the selected profile.

The mutations all carry the profile id in the path:

- `useAttachIndicator(profileId)` → `POST /profiles/:id/indicators` with `{ indicatorKey, inputs, label? }`.
- `useUpdateIndicator(profileId)` → `PUT /profiles/:id/indicators/:instanceId` (full-replace — same body as attach; matches the server's `PUT`).
- `useDetachIndicator(profileId)` → `DELETE /profiles/:id/indicators/:instanceId`.

A successful mutation invalidates `['profile-indicators', profileId]`.

The form **only edits `inputs` and (optionally) `label`** — `indicatorKey` is fixed by the catalog pick on create, and immutable on edit.
On `PUT`, the body still carries `indicatorKey` (the server requires it on full-replace) but it's the same one — the form doesn't expose it as editable.

## UI placement

The panel opens from a fourth button in the chart's bottom-bar `Flex` (after Profile, Symbol, Period) — labeled `"Indicators (N)"` (count of the profile's instances), or just `"Indicators"` when no profile is selected.
The icon is `lucide LineChart` (`aria-hidden="true"`).
The button opens a Radix Themes `Dialog`; nested dialogs (add / edit / detach) layer on top of that one.

This deliberately matches the profile-picker pattern — the chart bottom-bar is the single home for chart-scoped surfaces — and avoids changing the chart's grid layout for a persistent rail.

## Inputs form rendering (descriptor-driven)

A pure renderer that walks `definition.inputs` and emits one row per descriptor:

- `FieldType.Number` → `<input type="number">` (native), with `min` / `max` / `step` from the descriptor (`integer ? step=1 : descriptor.step`).
- `FieldType.Source` → Radix Themes `<Select>` whose options are every `PriceSource` value (label uses the enum value verbatim, lowercase).
- `FieldType.Enum` → Radix Themes `<Select>` whose options are the descriptor's `options[]` (`value` + `label`).

Defaults pre-fill from `descriptor.default` (every reference indicator declares one); for `Number` without a default the field starts blank and is required.
The "Submit" button is disabled while any field is empty (the descriptors don't declare optional fields in the current registry; an absent value is a validation failure).

## Submit + error handling

`POST` / `PUT` use the descriptor-derived values verbatim as the `inputs` object.
On success → the picker dialog closes back to the list view, a `toast.success` fires, and the list refetches.
On `400 { error }` → the message is surfaced inline as a Radix Themes `Callout color="red"` above the form footer (the server's domain validation is the authority — the client doesn't try to replicate `validateIndicatorInputs`'s rules).
Other failures surface as a `toast.error` with the `ApiError.message`.

## Acceptance criteria

Each bullet maps to exactly one test.

### `lib/hooks/indicators.ts`

- [ ] `useIndicatorCatalog()` issues `GET /indicators` and returns the array of definitions verbatim (full-payload `toEqual`).
- [ ] `useAttachIndicator(profileId).mutateAsync({ indicatorKey, inputs })` issues `POST /profiles/:profileId/indicators` with `{ indicatorKey, inputs }` as the JSON body and returns the created instance (full-payload).

### `pages/chart/indicators/indicator-inputs-form.tsx`

- [ ] A `Number` descriptor with `{ min, max, step, default }` renders an `<input type="number">` whose `min` / `max` / `step` / `defaultValue` attributes match the descriptor (full-payload of attribute snapshot).
- [ ] A `Source` descriptor renders a Radix `<Select>` whose options are every `PriceSource` value; the default selection matches the descriptor's `default`.
- [ ] An `Enum` descriptor renders a Radix `<Select>` whose options are the descriptor's `options[]` (label texts asserted as a sorted array); the default selection matches `descriptor.default`.
- [ ] Submitting the form fires `onSubmit({ inputs })` with the current field values (defaults included when the user didn't change them).

### `pages/chart/indicators/indicator-panel-dialog.tsx` (the bottom-bar trigger + Dialog shell)

Tests render with `<SelectedProfileProvider>` + `<QueryClientProvider>` + `<Theme>`, mocking `globalThis.fetch` (same pattern as `profile-picker-dialog.test.tsx`).

- [ ] The trigger button is labeled `"Indicators"` when no profile is selected.
- [ ] The trigger button is labeled `"Indicators (N)"` when a profile is selected, where N is `profile.indicators.length` (asserted with N=2 from the fixture).
- [ ] Opening the dialog with **no profile selected** renders a warning callout that contains the text `"Select or create a profile to add indicators"` and **no** "Add indicator" button.
- [ ] Opening the dialog with a profile selected lists every instance from `GET /profiles/:id/indicators` (one row per instance; row's accessible name includes the instance's `label` or the indicator's `name` fallback).
- [ ] A row for an instance whose definition's `appliesTo` excludes the current symbol's `SymbolType` renders muted with a visible `"n/a for <type>"` note (asserted for a `crypto`-only indicator on a `fx` symbol).
- [ ] Clicking "Add indicator" opens the catalog → inputs nested dialog; picking a catalog entry and submitting the inputs form issues `POST /profiles/:id/indicators` with `{ indicatorKey, inputs }` and closes the nested dialog back to the list.
- [ ] A `400 { error }` from `POST /profiles/:id/indicators` is surfaced inline above the form footer (no row is added; the nested dialog stays open).
- [ ] Editing an existing instance opens the inputs form pre-filled with the instance's `inputs` and on submit issues `PUT /profiles/:id/indicators/:instanceId` with the same `indicatorKey` plus the edited `inputs`.
- [ ] Detaching an instance (the row's delete icon → confirm in the nested `AlertDialog`) issues `DELETE /profiles/:id/indicators/:instanceId` and removes the row from the list.

### `pages/chart/chart-page.tsx` integration

- [ ] The chart's bottom-bar `Flex aria-label="Chart actions"` hosts the indicator-panel trigger (asserted by accessible name within the bottom bar).

## End-to-end expectation

Per the chart-page spec's convention, page-level behaviour for the web package is covered by the jsdom component tier (no browser e2e harness).
The existing `packages/web/tests/e2e/build.e2e.test.ts` is the only `*.e2e.test.ts` for the package; it asserts `vite build` produces an artifact whose JS bundle contains rendered marker strings.

For this feature, the e2e tier adds **one bundle-marker assertion**: the built JS bundle contains the static copy `"Select or create a profile to add indicators"`, confirming the indicator-panel module is wired into the live route tree and ships with the deployable artifact.
The build is shared with the existing markers via the same `beforeAll`.

Critical failure mode: `GET /profiles/:id/indicators` failing on chart load — the indicator-panel trigger still renders (labeled `"Indicators"`, count omitted because the data didn't load), and the rest of the chart page is unaffected.
Asserted in the panel-dialog jsdom test by responding `500` for `/profiles/:id/indicators`.

## Out of scope

- Drawing the overlays on the chart canvas / a chart legend — the "indicator overlays (historical)" task.
- Live overlay updates — the "indicator overlays (live)" task.
- Editing a profile's `scope` (handled by the profile picker; deferred there too).
- Editing the indicator's `label` field — the descriptor-driven form only edits `inputs` in this issue (label edit lands when there is a second concrete reason to expose it).
- Custom per-overlay color picker (later).
- Catalog search beyond a simple contains-match on `name` / `description` — the catalog has two entries today; a debounced server-side search is premature.
- A standalone `/profiles/:id/indicators` page — chart-side management is enough for now.
- Migrating stored instances when an indicator's `version` bumps (handled at attach time on the server; nothing for the panel to do).

## Surprises

(filled in retroactively)
