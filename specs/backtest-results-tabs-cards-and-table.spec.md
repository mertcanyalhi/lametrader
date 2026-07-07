# Spec: Backtest results tabs — color-coded metric cards + sortable/paginated trades table

- Status: draft
- Touches: `packages/ui/src/pages/backtesting/results-tabs.tsx` (the `ResultsTabs` panel and its `SummaryTab` / `TradesTab` / `DailyPnlTab` / `Metric` internals).

## Goal

Make the backtest results readable at a glance.
Each Summary and Daily-P&L metric renders as a Radix `Card` tinted by the sign of its value (green positive, red negative, neutral zero), and the Trades tab becomes a sortable, paginated table whose per-trade P/L amount and percentage are colored by sign.

## Acceptance criteria

Each bullet maps to exactly one unit test.

- [ ] A Summary metric with a positive value renders its value with the green (`grass`) accent.
- [ ] A Summary metric with a negative value renders its value with the red accent.
- [ ] A Summary metric whose value is zero renders its value with the neutral (`gray`) accent.
- [ ] A Daily-P&L block metric is colored by the sign of its value (Total P/L negative -> red).
- [ ] A trade row shows its own per-trade P/L amount and ROI percentage, each colored by the trade's sign (a winning trade -> green amount and green percentage).
- [ ] The trades table sorts by the P/L column when its header is clicked (ascending first click, descending second click).
- [ ] The trades table paginates: with more trades than one page holds, the first page shows a page's worth of rows and "Next" advances to the remainder.

## End-to-end expectation

`backtesting-run.e2e.test.ts` / `backtesting-saved.e2e.test.ts`: after a completed run, the Trades tab still exposes an `aria-label="Trades"` table whose data rows carry each trade's exit reason (and the open position as an unrealized final row), and the Summary / Daily-P&L blocks still expose each metric's label with its value as the label element's next sibling.
Critical rendering path unchanged: the label -> value sibling contract and row ordering the existing e2e asserts must still hold.

## Out of scope

- No new dependency: sorting/pagination is local `useState` (no `@tanstack/react-table`, which is not installed).
- No change to per-trade P/L math — `BacktestTrade.pnl` (net P/L after both commissions) and `BacktestTrade.roiPct` (P/L / entry cost basis = entry notional + entry commission, as a percentage) are reused verbatim from `@lametrader/core`; nothing is recomputed.
- No column-level filtering, no page-size selector (fixed page size), no sorting on columns beyond Entry and P/L.

## Surprises

Radix `Card` accepts only `size`/`variant` (no `color`), so the tint is a Radix accent alpha var on the card background (`var(--grass-a3)` / `var(--red-a3)` / `var(--gray-a3)`) plus the value `Text`'s `color` prop, which is what renders the testable `data-accent-color`.
