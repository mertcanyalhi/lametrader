## Spec: web form validation convention (chart dialogs)

- Status: draft
- Touches: `packages/ui/src/pages/chart/profile-picker-dialog.tsx`, `packages/ui/src/pages/chart/indicators/indicator-inputs-form.tsx`, `packages/ui/src/lib/profile-schema.ts` (new), `packages/ui/src/lib/indicator-inputs-schema.ts` (new).

## Goal

Bring the chart's profile form and indicator-inputs form onto the project's react-hook-form + Yup convention (per `packages/ui/CLAUDE.md` Forms section and ADR 0011), replacing the ad-hoc `name.trim() === ''` guard and the silent `NaN`-on-empty number with per-field, label-aware Yup messages surfaced inline before the request reaches the server.

The descriptor-driven indicator-inputs form uses a Yup schema **built at render time from its `FieldDescriptor[]`** — same convention surface (`yupResolver` + `lib/*-schema.ts`), schema construction kept dynamic because the field set is dynamic.

## Acceptance criteria

- [ ] Submitting the profile create/edit form with a blank name renders an inline "Name is required." under the name field and does not POST/PATCH.
- [ ] Submitting the indicator-inputs form with an empty Number field renders an inline "<Label> is required." under the field and does not call `onSubmit` (no `NaN` reaches the parent).
- [ ] Submitting the indicator-inputs form with a Number value below the descriptor's `min` renders an inline "<Label> must be ≥ <min>." and does not call `onSubmit`.
- [ ] Submitting the indicator-inputs form with a Number value above the descriptor's `max` renders an inline "<Label> must be ≤ <max>." and does not call `onSubmit`.
- [ ] Submitting the indicator-inputs form with a fractional value for an `integer: true` Number renders an inline "<Label> must be an integer." and does not call `onSubmit`.
- [ ] Submitting the indicator-inputs form with valid values calls `onSubmit` with parsed numeric values (the empty-string → `Number` coercion that previously emitted `NaN` is replaced by schema-level required validation, so a successful submit always carries finite numbers).

## End-to-end expectation

The deployable bundle (`vite build`) carries the new schema modules — `Name is required.` ships in the bundle for the profile form, and the descriptor-driven schema is reachable from the indicator-panel route — verified by string-presence checks in `tests/e2e/build.e2e.test.ts` (mirroring the existing pattern for the chart's modules).

## Out of scope

- Refactoring `settings-page.tsx` (already on the convention).
- Server-side rules — the API's domain validator remains the authority (per ADR 0011); this spec only changes the UI surface.
- Adding new field types or descriptor capabilities.

## Surprises

(none yet)
