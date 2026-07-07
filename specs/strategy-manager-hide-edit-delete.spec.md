# Spec: Hide strategy edit/delete controls until a strategy is selected

- Status: draft
- Touches: `packages/ui/src/pages/backtesting/strategy-manager.tsx`

## Goal

The `/backtesting` strategy manager's Edit and Delete controls should only appear once a strategy is selected.
Currently they render (merely disabled) with no selection, which clutters the toolbar and offers no-op affordances.
Render them only when a strategy is selected.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] The Edit and Delete controls are absent when no strategy is selected.
- [ ] The Edit and Delete controls are present once a strategy is selected.

## End-to-end expectation

Covered by the existing backtesting UI e2e path; this is a display-only guard with no new server round-trip.
Existing manager tests (open edit dialog, delete selected strategy) continue to pass because they select a strategy first.

## Out of scope

Any change to the New button, the selection state, or the delete-confirmation flow.

## Surprises
