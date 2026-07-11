# Spec: backtesting (single symbol)

- Status: approved
- Touches: `core` (backtesting types), `backend` (`analytics/backtesting` subsystem: strategy store, backtest store, backtest-event store, run service over an isolated rule engine that replays from an in-memory preloaded candle window, controllers), `ui` (`/backtesting` page, hooks, strategy editor dialog).

## Goal

Let the user define a reusable **backtest strategy** (entry/exit signals plus profit-target and stop-loss levels), run it against one symbol's stored candle history through the real rule engine, and get a saved, reloadable **backtest** (trades, summary metrics, daily P&L, and the events the run produced).
v1 is single-symbol; the shapes must not preclude multi-symbol runs later.

## Vocabulary

- **BacktestStrategy** — a named, symbol-agnostic entry/exit definition.
- **Signal** — an edge-triggered state change: it fires on the candle whose processing makes a symbol-scoped state key *become* a given value (`ChangesTo` semantics — a transition, not a level; a repeated set to the same value does not re-fire).
- **Backtest** — one run and its result; a single resource whose `status` moves `running → completed`.
  Only completed backtests are persisted; a running one is served from the in-memory job.
- **Trade** — one closed round trip (entry fill + exit fill); the position still open when the replay ends is an **open position**, not a trade.

## Domain model

### BacktestStrategy

- `id`, `name` (unique across strategies), `description?`, `createdAt`, `updatedAt`.
- `entry.signal: { key: string; value: StateValue }` — required (the UI renders it as a checkbox for forward-compatibility, but v1 requires it checked).
  The `value.type` doubles as the key's declared value type.
- `exit` — at least one of:
  - `signal?: { key: string; value: StateValue }`
  - `profitTarget?: { kind: BacktestThresholdKind; amount: number }`
  - `stopLoss?: { kind: BacktestThresholdKind; amount: number }`
- `BacktestThresholdKind` enum: `Fixed` (absolute price offset from entry) | `Percentage` (percent of entry price; stored as a percentage number, `5` = 5 %).

### Backtest

- `id` (the run id and the persisted id are the same), `name` (auto-generated `{strategy} · {symbol} · {period} · {start}→{end}` with UTC dates, renameable), `status` (`Running | Completed`), `createdAt`, `updatedAt`.
- `params`: `symbolId`, `profileId`, `profileName`, `period`, `start`, `end` (epoch ms), `initialCapital`, `commission: { rate?: number; fixed?: number }` (rate stored as a percentage number).
- `strategyId` plus a full embedded **strategy snapshot** as of run time (editing or deleting the strategy later must not change what a saved backtest means).
- `trades[]`, `openPosition?`, `summary` (shapes below).
- Run events are **not** embedded: they live in their own collection keyed by `backtestId` (a chatty profile over a long range would blow Mongo's 16 MB document cap) and are deleted by cascade with the backtest.

### Trade / open position

- Trade: `entryTs`, `exitTs`, `entryPrice`, `exitPrice`, `quantity`, `commission` (total paid, both fills), `pnl` (net of commissions), `roiPct`, `exitReason`.
- `BacktestExitReason` enum: `Signal | ProfitTarget | StopLoss`.
- Open position: `entryTs`, `entryPrice`, `quantity`, `entryCommission`, `unrealizedPnl`.
- `unrealizedPnl = quantity × lastClose − (entry notional + entryCommission)`, where `lastClose` is the close of the last replayed candle; no hypothetical exit commission is deducted.

### Summary

Computed over **closed trades only**; the open position is reported separately and excluded from realized aggregates.

- `totalPnl` = Σ trade `pnl`.
- `roiPct` = `totalPnl / initialCapital × 100`.
- `avgPnlPerTrade` = `totalPnl / tradeCount`.
- `tradeCount`, `winners` (`pnl > 0`), `losers` (`pnl < 0`); exact-zero trades count in `tradeCount` but in neither bucket.
- `avgRoiPct` = mean of per-trade `roiPct`.
- `avgDaysInTrade` = mean of `(exitTs − entryTs)` in fractional days.
- Per-trade `roiPct` = `pnl / (entry notional + entry commission) × 100`.

## Run semantics

### Isolation

- Each run wires a throwaway engine instance with its **own in-memory** state repository, event log, indicator series store, and once-per-bar latch, seeded with the selected profile's rules.
- The live state store, live event log, and live stream hubs are never touched.
- The notification executor is replaced with a no-op: `NotificationSent` events are still recorded in the run's event log, but nothing is sent.

### Replay

- The feed is every stored candle of **all of the symbol's active periods** (`WatchedSymbol.periods`) within `[start, end)`, each fed as a final `CandleEvent` through the same bar bridge → orchestrator path as live.
- Candles are ordered by **completion time** (`time + periodMillis(period)`); ties are broken finest-period-first.
  A candle exists only once it has closed, so a coarse bar can never leak its range before its hours have played out.
- Before the replay, the run **preloads a bounded candle window into an in-memory repository**: per active period, `[start − maxLookback(period) × periodMillis(period), end)`, where `maxLookback(period) = maxIndicatorWarmup + maxMovingLookbackBars + 64` (a per-period over-approximation from the profile's indicator instances and `Moving` leaves, plus a one-page margin).
- The engine, indicator series store, and a run-local indicator service read only this in-memory repo, so the replay issues **no per-candle candle-store round-trips** (ADR-0022).
- The in-memory repo is a performance layer, not a correctness authority: any read it cannot fully satisfy from its resident window **falls through to the shared candle store**. This keeps the unbounded `Crossing` / `Channel` walk-past-flats operators correct regardless of the preload size.
- Progress is `elapsed replay days / total days` of `[start, end]`.

### Trading model

- Long-only, one position at a time, all-in compounding with fractional quantity.
- Entry: while flat, an entry-signal transition buys at the close of the candle whose processing produced the `StateSet`; entry signals while a position is open are ignored.
- A fill is realized when its bar closes, so `entryTs` / `exitTs` are the bar's **close** instant (`time + periodMillis(period)`), not its open `time`.
- Entry sizing is cash-constrained including commission: `notional = (equity − fixed) / (1 + rate/100)`, `quantity = notional / entryPrice`.
- Exit-signal transitions sell the whole position at the producing candle's close.
- Profit target and stop loss are checked against **every processed candle's** high/low (the finest period naturally triggers first); the fill price is the level itself.
- Levels are entry-relative: profit target `Fixed` → `entryPrice + amount`, `Percentage` → `entryPrice × (1 + amount/100)`; stop loss `Fixed` → `entryPrice − amount`, `Percentage` → `entryPrice × (1 − amount/100)`.
- Within one candle the checks run **stop-loss before profit-target**, and both run before that candle's engine events (an intrabar level is hit before the close-driven signals).
- Consequently the entry candle itself is never checked against the levels — its high/low printed before the close where the entry filled; the levels apply from the next processed candle onward.
- Commission applies per fill (entry and exit): `rate` % of the fill's notional plus `fixed`, both optional and combinable; trade `pnl` is net of both fills' commissions.
- A same-candle round trip is allowed: events are consumed strictly in emission order, so entry-then-exit from one candle yields a zero-gross trade minus commissions.
- At the end of the replay an open position **stays open** (no forced liquidation) and is persisted as `openPosition`.

### Job lifecycle

- A run is a server-side job: it survives the client navigating away and auto-saves on completion.
- One run may be active at a time; starting a second is a conflict (409).
- Cancelling (or a run error) discards the run entirely; nothing partial is persisted.
- The run publishes no stream; progress is exposed on the running job and read by the client via `GET /backtests/:id` polling (ADR-0022).
- Jobs are in-memory: a server restart loses the active run (same stance as backfill jobs).

## Validation (run start, all → 400 unless noted)

- `start < end`, `end ≤ now`, `initialCapital > 0`, commission values `≥ 0`.
- The strategy must define an entry signal and at least one exit mechanism.
- The profile must be enabled and its scope must include the symbol.
- The candle store must hold at least one candle in `[start, end)` across the symbol's active periods, else 400 with a "backfill first" message.
- Unknown strategy / symbol / profile / backtest ids → 404.

## API

`/backtest-strategies` — plain CRUD, mirroring `/profiles`:

- `GET /backtest-strategies` → 200 list.
- `POST /backtest-strategies` → 201; duplicate name → 409.
- `GET|PUT|DELETE /backtest-strategies/:id` → 200 / 200 / 204; unknown id → 404.
- Deleting a strategy does **not** cascade to saved backtests (they carry their snapshot).

`/backtests` — one resource with a lifecycle:

- `POST /backtests` → **202** with the new backtest (`status: Running`); **409** while another run is active.
- `GET /backtests` → all backtests, the in-memory running one merged in; `?status=` filters.
- `GET /backtests/:id` → running: params + progress snapshot; completed: the full saved result.
- `PATCH /backtests/:id` → rename; **400** while running.
- `DELETE /backtests/:id` → running: cancel + discard; completed: delete + cascade events; **204** either way.
- `GET /backtests/:id/events?from&to&limit` → windowed run events (same shape as the live rule-events window); **400** while running (an in-flight run's events are persisted only on completion).

## UI — the `/backtesting` page

- New sidebar entry "Backtesting"; the chart page is untouched (no side panel there).
- Layout: chart ≈ ⅔ left, panel ≈ ⅓ right; symbol / profile / period pickers and the strategy-manager trigger live in a **bottom action bar** like the other pages.
- Right panel: strategy selector, run form (`Initial capital`, start/end dates, commission Rate / Fixed checkboxes with amount fields), Run / Cancel button, progress bar, results tabs **Summary | Trades | Daily P&L**, and the saved-backtests list (load / rename / delete).
- Strategy editor dialog: Entry section (Signal checkbox + key/value), Exit section (Signal, Profit, Stop loss checkboxes), threshold kind dropdowns with info-icon tooltips explaining Fixed vs Percentage.
- The state-key selector reuses the rules-editor machinery: find-or-create combobox seeded from the selected symbol's `GET /symbols/:id/state-keys`, known keys adopt their catalog type, unknown keys declare one; the value widget follows the type (string → text or enum-select, bool → checkbox, number → numeric).
- During a run (or with a loaded backtest) the symbol / profile / period pickers are locked; loading a saved backtest sets the chart to its stored period.
- During a run the panel shows only a **progress bar** (plus the run's metadata); the chart, trades, summary, and daily-P&L render once the run reaches `Completed`, through the same path a saved backtest loads through (result + candles + windowed events over REST). The chart is the reused `CandleChart`: state overlays render from the run's events, and its trades draw entry/exit markers.
- Trades tab: entry/exit timestamps, buy/sell price, P/L, ROI %, exit reason; the open position renders as the last row with exit columns empty and its P/L marked unrealized.
- Daily P&L tab: a `lightweight-charts` `HistogramSeries` of per-day P/L (a trade's whole P/L lands on its **exit day**, bucketed in UTC), with the summary block below (number of trades, winners/losers, average ROI per trade, total P/L, average days in trade).

## Acceptance criteria

### Strategy store & API

- [ ] `POST /backtest-strategies` persists the strategy and returns 201 with the full payload.
- [ ] `POST /backtest-strategies` with a duplicate name returns 409.
- [ ] `POST /backtest-strategies` without an entry signal or without any exit mechanism returns 400.
- [ ] `GET`, `PUT`, `DELETE /backtest-strategies/:id` behave RESTfully (200/200/204, 404 on unknown id).
- [ ] Deleting a strategy leaves its saved backtests intact.
- [ ] The strategy repository contract suite passes against both the in-memory fake and the Mongoose adapter.

### Run validation

- [ ] `POST /backtests` with `start ≥ end`, `end > now`, `initialCapital ≤ 0`, or a negative commission returns 400.
- [ ] `POST /backtests` for a profile whose scope excludes the symbol (or a disabled profile) returns 400.
- [ ] `POST /backtests` with no stored candles in range returns 400 with a backfill hint.
- [ ] `POST /backtests` while another run is active returns 409.

### Replay engine

- [ ] A run feeds all active periods' candles in completion-time order, ties finest-first (asserted via the recorded event order).
- [ ] A run writes nothing to the live state repository or live event log, and sends no notification.
- [ ] `NotificationSent` events from the profile's rules are recorded in the run's event log without a send.
- [ ] A run preloads `[start − maxLookback(period), end)` per active period and completes with **no per-candle candle-store round-trips** (asserted via a read-counting store — reads stay constant as the replayed candle count grows).
- [ ] A lookback reaching **below** the preloaded floor falls through to the shared store and returns the correct data (a signal on the first in-range candle whose lookback reaches before `start` computes correctly; the read-through delegation is asserted at the repository level).
- [ ] `maxLookback` = `maxIndicatorWarmup + maxMovingLookbackBars + 64` per period (a `Crossing` / `Channel` leaf contributes nothing — it is fallback-covered).
- [ ] Progress is reported on the running job and readable via `GET /backtests/:id`.

### Trading model

- [ ] An entry-signal transition while flat opens a position at the producing candle's close with cash-constrained quantity `(equity − fixed) / (1 + rate/100) / price`.
- [ ] An entry signal while a position is open is ignored.
- [ ] A repeated `StateSet` to the same value does not re-trigger a signal (edge, not level).
- [ ] An exit-signal transition closes the position at the producing candle's close with `exitReason: Signal`.
- [ ] A candle whose high reaches a `Fixed` profit-target level closes the position at the level with `exitReason: ProfitTarget`.
- [ ] A candle whose high reaches a `Percentage` profit-target level closes the position at the level with `exitReason: ProfitTarget`.
- [ ] A candle whose low reaches a `Fixed` stop-loss level closes the position at the level with `exitReason: StopLoss`.
- [ ] A candle whose low reaches a `Percentage` stop-loss level closes the position at the level with `exitReason: StopLoss`.
- [ ] The entry candle's own high/low does not trigger the levels; they apply from the next processed candle onward.
- [ ] When one candle spans both levels, the stop-loss wins.
- [ ] Commissions are charged per fill and the trade's `pnl` is net of both.
- [ ] A same-candle entry-then-exit yields a trade whose gross is zero and whose net is minus the commissions.
- [ ] A position still open at `end` is persisted as `openPosition` with unrealized P/L at the last replayed close, and no trade is appended.
- [ ] Equity compounds: the second trade's entry notional derives from the first trade's proceeds.

### Metrics

- [ ] The summary computes `totalPnl`, `roiPct`, `avgPnlPerTrade`, `tradeCount`, `winners`/`losers` (zero-pnl in neither), `avgRoiPct`, and `avgDaysInTrade` (fractional) over closed trades only.
- [ ] Per-trade `roiPct` divides net pnl by entry cost basis (notional + entry commission).
- [ ] Daily P&L buckets each trade's whole pnl on its exit day in UTC.

### Backtest resource & persistence

- [ ] A completed run auto-persists the backtest (auto-generated name, params, strategy snapshot, `strategyId`, `profileId` + `profileName`, trades, `openPosition?`, summary) under the run's id.
- [ ] Run events persist to the backtest-event collection keyed by `backtestId` and are readable via `GET /backtests/:id/events?from&to&limit`.
- [ ] `GET /backtests` merges the in-memory running backtest with the persisted completed ones and honors `?status=`.
- [ ] `PATCH /backtests/:id` renames a completed backtest and returns 400 for a running one.
- [ ] `GET /backtests/:id/events` returns 400 for a running backtest.
- [ ] `DELETE /backtests/:id` on a running backtest cancels and discards it; nothing is persisted.
- [ ] `DELETE /backtests/:id` on a completed backtest removes it and cascades its events.
- [ ] Editing the source strategy after a run leaves the saved backtest's snapshot unchanged.
- [ ] The backtest and backtest-event repository contract suites pass against both fakes and Mongoose adapters.

### UI

- [ ] The strategy editor requires the entry signal and at least one exit mechanism before saving.
- [ ] The state-key combobox seeds from the selected symbol's catalog and the value widget follows the key's type (text / enum-select / checkbox / numeric).
- [ ] Starting a run locks the pickers and shows a progress bar; the chart and results render once the run completes, through the loaded-backtest path.
- [ ] The trades table renders closed trades with exit reasons and the open position as an unrealized final row.
- [ ] The Daily P&L tab renders the histogram plus the summary block.
- [ ] Loading a saved backtest restores the chart (stored period), trade markers, state overlays, and all three result tabs without a run.

## End-to-end expectation

Backend e2e (Testcontainers Mongo): seed a watched symbol with candles across two periods and a profile whose rule sets a state key; create a strategy keyed to that state change; `POST /backtests`; poll `GET /backtests/:id` until `Completed`; assert the persisted backtest's trades, summary, and windowed events over HTTP.
Critical failure mode: a second `POST /backtests` during the run returns 409, and `DELETE /backtests/:id` mid-run cancels without persisting anything.

UI e2e: drive the `/backtesting` page — create a strategy, run it, watch progress reach completion, and assert the summary, trades table, and daily P&L render; then reload the saved backtest and assert the same results render without a run.

## Out of scope

- Multi-symbol runs (shapes stay compatible; execution is single-symbol).
- Short selling, non-all-in sizing, pyramiding.
- Signal composition (AND/OR trees) and operators other than the implicit `ChangesTo`.
- Global-scope state keys in signals.
- Concurrent runs.
- The chart-page "Backtest this" deep-link button.
- Gross-vs-net P/L toggle (gross is derivable later from stored per-trade commissions).
- Surviving a server restart mid-run.

## Surprises

