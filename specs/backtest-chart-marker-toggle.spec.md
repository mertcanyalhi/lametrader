# Spec: Hide backtest chart trade markers behind a settings cog

- Status: draft
- Touches: `packages/ui` — `pages/backtesting/backtesting-page.tsx` (backtesting page only)

## Goal

On the backtesting page's chart, the Buy/Sell trade markers are hidden by default and revealed only when the user opts in through a chart settings cog.
This declutters the run/saved-backtest chart, letting the price action read cleanly until the trader asks for the entry/exit annotations.
Scope is the backtesting page alone — the main `/chart` page's rule-event markers are untouched.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] The chart receives no trade markers by default — with a loaded backtest, `CandleChart`'s `eventMarkers` is empty.
- [ ] A "Chart settings" cog button is present on the chart once a chart is shown.
- [ ] Toggling "Show trade markers" on passes the built trade markers to `CandleChart`.

## End-to-end expectation

Loading a saved backtest fills the chart and renders the Trades table; the chart's markers stay off by default (the existing saved-backtest e2e asserts the Trades table, not chart markers, so it is unaffected).
Critical behaviour preserved: state overlays are never gated — they still render regardless of the marker toggle.

## Out of scope

- Persisting the toggle across reloads — the preference is session-scoped (`useState`), reset on reload.
- Any change to `CandleChart` itself or to the `/chart` page markers.

## Surprises

(none yet)
