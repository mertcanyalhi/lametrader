# Spec: Backtesting "Previous runs" modal

- Status: draft
- Touches: `packages/ui` backtesting page — `BacktestingPage` bottom bar + `SavedBacktestsList` (new `PreviousRunsDialog` trigger).

## Goal

The saved-backtests list no longer sits inline in the right panel.
Instead the bottom action bar carries a **"Previous runs {n}"** button (`{n}` = the count of saved backtests) that opens a modal hosting the existing saved-backtests list.
This mirrors the chart page's bottom-bar count-badge dialogs (States / Rules) so the two pages feel identical.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] The `PreviousRunsDialog` trigger renders labelled with the saved-backtests count (`Previous runs (2)`) once the count query resolves.
- [ ] Clicking the trigger opens a modal whose body is the saved-backtests list (its entries visible).
- [ ] The trigger renders a loading indicator (accessible name `Previous runs (loading)`), not `Previous runs (0)`, while its count query is pending.
- [ ] The backtesting page hosts the `Previous runs` trigger inside its bottom action bar (`Backtesting actions` group).

## End-to-end expectation

Covered by the existing `backtesting-saved.e2e`-style page suite (`backtesting-saved.test.tsx`): opening the modal, loading a saved backtest, and closing it back to idle.
The trigger placement + open + loading-state distinction are pure render-state concerns with no new server round-trip, so they are proven at the unit tier.

## Out of scope

- Any change to the saved list's internal load / rename / delete behaviour — `SavedBacktestsList` is reused verbatim inside the modal.
- A new count hook — the trigger reuses `useCompletedBacktests` (the same query the list already runs; TanStack Query dedupes it).
- A count cap (`99+`) — the saved-backtests count is small; render the raw number.

## Decisions

- The trigger is `disabled` while the page is `locked` (a run is active or a saved backtest is loaded), preserving the prior behaviour where the inline saved list was hidden in those states and matching the sibling pickers.

## Surprises

_None yet._
