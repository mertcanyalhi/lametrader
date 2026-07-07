# Spec: Show backtest trade markers by default, gate rule events behind bottom-bar chart settings

- Status: draft
- Touches: `packages/ui` — `pages/backtesting/backtesting-page.tsx` (backtesting page only)

## Goal

On the backtesting page's chart, the Buy/Sell trade markers show by default, while the run's recorded rule-event overlays are hidden until the trader opts in through a chart-settings control in the bottom bar.
Trade markers are the primary annotation a trader wants on a run/saved-backtest chart, so they read immediately; the noisier rule-event overlays stay off until asked for.
The control lives in the bottom-bar actions group (next to "Previous runs"), not floating over the chart, so it never overlaps the chart's right-hand price scale.
Scope is the backtesting page alone — the main `/chart` page's markers are untouched.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] Trade markers show by default — with a loaded backtest that has one trade, `CandleChart`'s `eventMarkers` is populated (2 markers) and `stateOverlays` is empty, without any toggle.
- [ ] A "Chart settings" button is present in the bottom bar once a chart is shown.
- [ ] Toggling "Show rule events" on passes the built rule-event overlays to `CandleChart`'s `stateOverlays`.
- [ ] During a live run, trade markers from the frames draw by default with no toggle, while rule-event overlays stay empty.
- [ ] During a live run, toggling "Show rule events" on draws the run's rule-event overlays.

## End-to-end expectation

Loading a saved backtest fills the chart and renders the Trades table; the trade markers show by default and the rule-event overlays stay off until toggled (the existing saved-backtest e2e asserts the Trades table, not chart markers/overlays, so it is unaffected).
Critical behaviour preserved: trade markers are never gated — they render regardless of the rule-events toggle.

## Out of scope

- Persisting the toggle across reloads — the preference is session-scoped (`useState`), reset on reload.
- Any change to `CandleChart` itself or to the `/chart` page markers.

## Surprises

(none yet)
