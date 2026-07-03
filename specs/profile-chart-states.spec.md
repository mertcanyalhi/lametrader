# Spec: profile chartStates field

- Status: draft
- Touches:
  - `core` — `ProfileFields` type; `parseProfileFields` / `mergeProfileFields` validators.
  - `engine` — `MongoProfileRepository` document mapping + shared `ProfileRepository` contract (`InMemoryProfileRepository` needs no change — it stores the domain object as-is).
  - `api` — `profile.schema` (`ProfileSchema`, `ProfileInputSchema`, `ProfilePatchSchema`).
  - `web` — `lib/profile-schema.ts` (`ProfileFormValues`, `profileFormSchema`); `pages/chart/profile-picker-dialog.tsx` (create carries the field, edit-PATCH omits it so the server preserves it).

## Goal

Give a profile a `chartStates: string[]` field — the list of symbol-state keys whose markers the chart should render — and make it round-trip end-to-end through the stack **with no editing UI yet**.
The core type carries it, the create/replace/patch validators default and accept it, the API persists and echoes it, and the web profile-form schema carries it (defaulting to `[]`) so a loaded profile's value survives a save even though no control edits it.

Default is `[]` (empty): per parent #452 an empty `chartStates` means "render nothing", so existing profiles start blank with no migration/back-fill.
`chartStates` behaves exactly like `scope` in the picker — sent on create, omitted on edit-`PATCH` so the server preserves it.

## Acceptance criteria

Each bullet maps to exactly one test.

Domain (`core`):

- [ ] `parseProfileFields` defaults a missing `chartStates` to `[]` (full-payload).
- [ ] `parseProfileFields` accepts a provided `string[]` `chartStates` unchanged (full-payload).
- [ ] `parseProfileFields` throws `ProfileError` on a non-array `chartStates`.
- [ ] `parseProfileFields` throws `ProfileError` on a `chartStates` whose elements aren't all strings.
- [ ] `mergeProfileFields` preserves the current `chartStates` when the patch omits it (full-payload).
- [ ] `mergeProfileFields` replaces `chartStates` when the patch provides a new array (full-payload).

Persistence contract (`ProfileRepository`, in-memory in unit / Mongo in e2e):

- [ ] A profile carrying a non-empty `chartStates` save→get→list round-trips it (covered by the shared contract's existing round-trip bullets once the fixture carries the field).

API (`profiles.controller` over in-memory repos):

- [ ] `POST /profiles` with `chartStates` persists and echoes it; created without it, a profile reads back `chartStates: []`.
- [ ] `PATCH /profiles/:id` that omits `chartStates` preserves the stored value.
- [ ] `PATCH /profiles/:id` that provides `chartStates` replaces the stored value.
- [ ] `POST /profiles` with a non-array `chartStates` is rejected at the boundary with `400`.

Web (`lib/profile-schema.ts`):

- [ ] `profileFormSchema` casts an input missing `chartStates` to `chartStates: []` (default, full-payload).
- [ ] `profileFormSchema` validates and round-trips a provided `chartStates` untouched (full-payload).

## End-to-end expectation

API e2e over real Mongo (Testcontainers): `POST /profiles` with `chartStates: ['price:trend']` (201) → `GET /profiles/:id` echoes it → `PATCH { enabled: false }` (omitting `chartStates`) preserves `['price:trend']` → `PATCH { chartStates: [] }` clears it to `[]`.

Critical failure mode: `POST /profiles` with `chartStates: 'nope'` (a non-array) → **400**, nothing persisted.

## Out of scope

- The editing control (a chips combobox) — a later slice.
- The chart-side consumption that reads `chartStates` to render markers — the integration slice.
- Migration / back-fill of existing profiles (they start `[]`).
- A CLI flag for `chartStates` (the server default covers create; no CLI surface changes).

## Surprises

(filled in retroactively)
