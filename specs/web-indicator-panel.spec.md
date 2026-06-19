# Spec: web chart indicator panel (manage selected profile's indicators)

- Status: draft
- Touches: `@lametrader/web` driving adapter — new `lib/hooks/indicators.ts` (TanStack Query over `GET /indicators`, `POST /profiles/:id/indicators`, `PUT/DELETE /profiles/:id/indicators/:instanceId`), new `pages/chart/indicators/indicator-panel-dialog.tsx` (the bottom-bar trigger + Dialog shell), `pages/chart/indicators/indicator-panel.tsx` (the list/empty body), `pages/chart/indicators/add-indicator-dialog.tsx` (two-step catalog → inputs nested dialog, also reused for edit), `pages/chart/indicators/indicator-inputs-form.tsx` (descriptor-driven form), `pages/chart/indicators/detach-indicator-dialog.tsx` (confirmation `AlertDialog`).
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
- The selected profile's embedded `indicators[]` (from the existing `useProfiles` cache) — single source of truth, refetched together with the rest of the profile state.

The mutations all carry the profile id in the path:

- `useAttachIndicator(profileId)` → `POST /profiles/:id/indicators` with `{ indicatorKey, inputs, label? }`.
- `useUpdateIndicator(profileId)` → `PUT /profiles/:id/indicators/:instanceId` (full-replace — same body as attach; matches the server's `PUT`).
- `useDetachIndicator(profileId)` → `DELETE /profiles/:id/indicators/:instanceId`.

A successful mutation invalidates the `['profiles']` query (the single source of truth for the embedded `indicators[]`).

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

Critical failure mode: `GET /indicators` (the catalog) failing on chart load — the indicator-panel trigger still renders (the count still works because it comes from the cached profiles), opening the panel lists the profile's existing instances with their `indicatorKey` (no n/a check, since the catalog isn't available), and the rest of the chart page is unaffected.
Asserted in the panel-dialog jsdom test by responding `500` for `/indicators`.

## Out of scope

- Drawing the overlays on the chart canvas / a chart legend — the "indicator overlays (historical)" task.
- Live overlay updates — the "indicator overlays (live)" task.
- Editing a profile's `scope` (handled by the profile picker; deferred there too).
- Editing the indicator's `label` field — the descriptor-driven form only edits `inputs` in this issue (label edit lands when there is a second concrete reason to expose it).
- Custom per-overlay color picker (later).
- Catalog search beyond a simple contains-match on `name` / `description` — the catalog has two entries today; a debounced server-side search is premature.
- A standalone `/profiles/:id/indicators` page — chart-side management is enough for now.
- Migrating stored instances when an indicator's `version` bumps (handled at attach time on the server; nothing for the panel to do).

## Follow-up additions (post-review polish, same PR)

- **Bug fix**: detaching an indicator was closing both the AlertDialog and the parent panel Dialog, because `AlertDialog.Action`'s default `onSelect` dispatches a click that bubbles through Radix's portal stack.
  The Detach button is no longer wrapped in `AlertDialog.Action`; `handleConfirm` drives the close itself so only the AlertDialog dismisses.
- **Helper-text removal**: the panel Dialog no longer prints "Indicators attached to '<profile>'" — the title alone is enough.
- **Bordered list rows**: instance rows, profile-picker rows, and symbol-picker rows all gain a 1px gray-token border for visual grouping (unified style across all three chart-bottom-bar pickers).
- **`Badge`-rendered asset class**: the catalog picker shows each definition's `appliesTo[]` as soft-gray `Badge`s instead of bare grey text.
- **Input descriptors carry an optional `description`**: `NumberFieldDescriptor` / `SourceFieldDescriptor` / `EnumFieldDescriptor` in `@lametrader/core` gain `description?: string`; the API schema and the SMA / VWMA reference modules carry text for every input; the inputs form renders the existing `FieldLabel` (info icon → popover) when a descriptor declares one, falling back to a plain label otherwise.
- **Indicator modules gain a `summary(inputs) → string` function**: declared on `IndicatorModule` (not the serializable `IndicatorDefinition` — it's a function), implemented on `sma` (`"SMA <length> <source>"`) and `vwma` (`"VWMA <length> <source> ±<multiplier>/1000 <direction>"`).
  `IndicatorInstance` gains `summary?: string` as a transport-only field, set by `ProfileService` on every read path (`list`, `get`, `listIndicators`, `getIndicator`, `addIndicator`, `replaceIndicator`, `create`, `replace`, `update`) via a private `enrichInstance` helper.
  The field is **never persisted** — mutators read via a new `getStored` that skips enrichment, so the stored profile shape is unchanged.
  The panel's `InstanceRow` displays `instance.summary` next to the display name in a small monospaced font, so the user sees "Simple Moving Average · SMA 14 close" at a glance.
  The chart's top-left overlay will reuse the same string in a follow-up (#43).

## Surprises

(filled in retroactively)
