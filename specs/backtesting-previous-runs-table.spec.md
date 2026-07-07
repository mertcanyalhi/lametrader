# Spec: Previous runs list becomes a sortable, paginated table

- Status: draft
- Touches: `packages/ui/src/pages/backtesting/saved-backtests-list.tsx` (the `SavedBacktestsList` used by the "Previous runs" modal)

## Goal

Turn the "Previous runs" saved-backtests list from a flat `Flex` list into a Radix `Table` with sortable columns and client-side pagination, mirroring the Trades table in `results-tabs.tsx`.
This makes a growing history of saved runs scannable and navigable without adding any dependency.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] Renders one table row per saved backtest, each row carrying its name, trade count, and total P/L.
- [ ] Defaults to sorting by created date descending (most recent run first).
- [ ] Clicking the Name header sorts the rows by name ascending.
- [ ] Clicking the Name header again toggles the sort to descending.
- [ ] With more than one page of runs, clicking Next reveals a run that was on the second page.
- [ ] With a single page of runs, no pagination controls are shown.
- [ ] Clicking a run's name still calls `onLoad` with that backtest (load preserved).
- [ ] Renaming a run through its row action still round-trips through the API and refreshes the list (preserved).
- [ ] Deleting a run through its row action still round-trips through the API and refreshes the list (preserved).
- [ ] Shows the empty hint when there are no saved backtests (preserved).

## End-to-end expectation

`backtesting-saved.e2e.test.ts`: open the "Previous runs" modal and click the saved run by name — the run still loads and renders identically after the list becomes a table (the name remains a button with the run's accessible name).

## Out of scope

- Server-side sorting/filtering or pagination — all client-side over the already-fetched list.
- Column configuration, resizing, or a data-grid dependency (`@tanstack/react-table` is not installed).
- Extracting a shared `SortButton` — the local copy mirrors the one in `results-tabs.tsx`; extract on the third instance.

## Surprises

Empty (fill in retroactively).
