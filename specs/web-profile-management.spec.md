# Spec: web profile management — create / edit / delete (#39, iteration 2)

- Status: implemented
- Touches: `web` only.
  Adds mutation hooks to `lib/hooks/profiles.ts` (`useCreateProfile`, `useUpdateProfile`, `useDeleteProfile`), a Yup form schema (`lib/profile-schema.ts`), and the management UI under `components/profiles/` (`manage-profiles-dialog.tsx`, `profile-form-dialog.tsx`, `delete-profile-dialog.tsx`), reached from a "Manage profiles" control in the status bar.
  Backend untouched — the profiles API already exists.

## Goal

Build on iteration 1's selection surface with the profile **management** flows: create, edit, and delete profiles from a dedicated dialog opened off the status bar, with inline validation, duplicate-name handling, and toasts.

## Background

Iteration 1 landed the selection store, the bottom status bar, and the read-only selector.
This iteration adds management.
Per the brainstorm the entry point is a **dedicated manage dialog**: a "Manage profiles" control in the status bar opens a dialog listing every profile with per-row Edit / Delete plus a "New profile" action; create/edit share a form dialog and delete uses an `AlertDialog`.

The create/edit form edits **`name`, `description`, `enabled`** only.
The issue names `PUT` for edit, but `PUT` (`replace`) re-defaults an omitted `scope` to `All` — which would silently wipe a `Symbols`-scoped profile.
To honour the issue's stated behaviour ("preserves `scope` + attached indicators untouched; the page never sends `scope`/`indicators`"), edit uses **`PATCH`** (`update` → `mergeProfileFields`), the partial-update verb that keeps absent fields.
Create posts `{ name, description, enabled }`; the domain defaults `scope` to `All`.

Name uniqueness is enforced server-side; the form surfaces the `409 { error }` inline under the name field.
Form validation uses `react-hook-form` + Yup (`lib/profile-schema.ts`), matching `lib/config-schema.ts`.

## Acceptance criteria

Each bullet maps to exactly one test (jsdom; `fetch`-boundary mock + real `QueryClient`, mirroring iteration 1).

### Hooks (`lib/hooks/profiles.ts`)

- [x] `useCreateProfile` issues `POST /api/profiles` with the form input and returns the created profile.
- [x] `useCreateProfile` invalidates the profiles query on success so the list refetches.
- [x] `useUpdateProfile` issues `PATCH /api/profiles/:id` with only `name` / `description` / `enabled` (no `scope`, no `indicators`).
- [x] `useDeleteProfile` issues `DELETE /api/profiles/:id`.

### Form schema (`lib/profile-schema.ts`)

- [x] `profileSchema` rejects an empty name with a label-aware required message.
- [x] `profileSchema` accepts a valid `{ name, description, enabled }` input.

### Form dialog (`components/profiles/profile-form-dialog.tsx`)

- [x] In create mode, submitting the form posts the input and on success selects the new profile, shows a success toast, and closes.
- [x] In edit mode, the form is pre-filled with the profile's name/description/enabled and submitting issues the `PATCH`.
- [x] A duplicate name surfaces the server's `409 { error }` inline under the name field and the dialog stays open.
- [x] Submitting with an empty name shows the required error and issues no request.

### Delete dialog (`components/profiles/delete-profile-dialog.tsx`)

- [x] The confirm dialog names the profile and on confirm issues the `DELETE` and shows a success toast.

### Manage dialog + status bar

- [x] `ManageProfilesDialog` lists every profile with an Edit and a Delete control each, plus a "New profile" control.
- [x] The status bar exposes a "Manage profiles" control that opens the manage dialog.

## End-to-end expectation

The browser-side e2e is the web build (`packages/web/tests/e2e/build.e2e.test.ts`) staying green with the management code compiled in.
The end-user flows — create → selected, edit, delete — are asserted by the jsdom component tests above.

Deleting the selected profile falls back to the first remaining enabled profile via iteration 1's selector reconciliation (`resolveSelectedProfileId` + the reconcile effect), already covered by `resolve-selected-profile.test.ts` and `profile-selector.test.tsx`; no new test duplicates it.

## Out of scope (later iterations)

- The chart relocating its symbol + period controls into the bottom bar, and `?profile=` URL sync (iteration 3).
- Editing a profile's `scope` (All vs symbol subset) or its attached indicators.
- Indicator overlays driven by the selection (the overlay task).

## Surprises

(none yet)
