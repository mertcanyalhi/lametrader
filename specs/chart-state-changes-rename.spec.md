# Spec: chart "State changes" rename

- Status: draft
- Touches: `web` — the chart's bottom-bar state-overlay picker (`StatesPanelDialog`); no port, use-case, or adapter behaviour changes.

## Goal

Rename the chart's bottom-bar **States** button and the dialog it opens to **State changes** — a clearer name for the same state-overlay picker.
Only the user-visible name changes: the visible button label, the button's `aria-label` (accessible name), and the dialog title.
Everything else is untouched — the same overlays, the same picker body, the same `(profileId, symbolId)` `localStorage` persistence, the same `GET /symbols/:id/state-keys` data source.
The `specs/chart-state-overlays.spec.md` references to the button's user-visible name are synced to the new name in the same change.

## Acceptance criteria

Each bullet maps to exactly one test.
If a line of code maps to no bullet, it shouldn't be written.

- [ ] With no profile selected, the trigger button exposes **State changes** as both its accessible name (`aria-label`) and its visible text label.
- [ ] With a profile selected, the trigger button's accessible name is **State changes (N)**, where `N` is the count of currently overlaid keys for `(profileId, symbolId)`.
- [ ] The opened dialog's title heading reads **State changes**.
- [ ] Selection persistence is unchanged — toggling a state-key checkbox writes the next selection set to `localStorage` under `(profileId, symbolId)` and bumps the trigger's badge count.

## End-to-end expectation

Not applicable — this is a UI-string rename with no HTTP-boundary behaviour.
The `web` package has no browser e2e harness (page-level behaviour is covered by the unit tier, per `packages/ui/README.md`), and the endpoints the picker reads are unchanged, so the existing `packages/api/tests/e2e/chart-state-overlays.e2e.test.ts` still pins the untouched state-keys/series contract.

## Out of scope

- Renaming the `StatesPanelDialog` component, its file/directory, its props, or the `chart-state-overlays` `localStorage` key — internal identifiers keep the feature's identity; only the user-visible name changes.
- Adding a `<Tooltip>` — the trigger is a text `<Button>` whose visible label already satisfies the accessibility rule (real `aria-label` name plus a visible text label); it is not an icon-only button.
- Any change to the state overlays, the picker body, the data source, or the events filter the rest of #452 introduces.

## Surprises

(Filled in retroactively if anything bites — empty by default.)
