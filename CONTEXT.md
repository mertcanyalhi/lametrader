# lametrader

Quant trading platform: ingest market data, persist it, compute indicators, evaluate rules, fire side-effects.

## Language

### Rule engine — validation + migration

**Schema validation**:
Rule create / update validates every field against the schema (operand types match operator's accepted shapes, required `interval` present where needed, referenced indicator instance + telegram destination exist, etc.). Returns 4xx with field-level errors. The engine trusts the schema at evaluation time — no runtime type-mismatch guards.
_Avoid_: runtime type checks (the validator is the sole gate).

**NULL operand semantics**:
Distinct from type validation. NULL values are a legitimate "no data yet" state (indicator hasn't computed its first bar; state key never set). Operators handle NULL as part of their semantics — comparison returns `false`, crossing returns `false`, state operators apply their NULL rules per #362. NULL is not a schema bug and does not blow up the engine.

**v1 → present cutover** (historical):
No migration script ran. v1's engine ran in production until the present rules engine shipped; the maintainer manually deleted v1 rules and re-created them in the new editor. The cutover issue (#397 / PR #421) retired v1 once no profile was using it. The greenfield engine shipped behind a feature flag during the build to keep its UI out of users' view; the flag was dropped at cutover.

### Rule engine — meta

**Rule engine**:
The rule engine, schema, and UI shipped as the greenfield rebuild in #387–#397 (per ADR 0016).
The previous engine (`condition-evaluator`, `trigger-evaluator`, `action-runner`, `live-evaluation-lookups`, the old `TriggerKind` enum, the old rule-editor UI) was retired by the cutover in PR #421.
The follow-up cleanup in issue #422 dropped the `-v2` suffix from every code identifier, file basename, and REST route — the live engine reads as "rules" everywhere.

### Rule engine — cadence

**Tick**:
One price update from a live quote stream. Sole source: `QuoteStreamService` subscriptions. A rule can only react to ticks on a symbol that has a live quote subscription open.
_Avoid_: quote-tick (redundant), price-change, last-price-update.

**Bar**:
One bar (candle) on a given `Period`, from the polling loop or backfill.

**Trigger granularity**:
Which event channel drives a rule's re-evaluation cadence: `tick`, `bar`, or `periodic` (wall-clock timer).
Independent of which operands the rule reads.

### Rule engine — shape

**Condition tree**:
Conditions compose into a tree of `And` / `Or` group nodes and `Leaf` condition rows. Preserved from today. UI's "+ Add condition" appends a sibling under the current group; default root is `And`. Each leaf is one `(left, operator, right?, interval?)` row.

**Rule scope**:
A rule applies to one symbol, several explicit symbols, or every watched symbol on the parent profile. Three variants: `Symbol(symbolId)`, `Symbols(symbolIds[])`, `AllSymbols`. AllSymbols and Symbols fan the trigger out across each matching symbol independently — one fire decision per symbol per event. Operands always read from the firing symbol (no cross-symbol operand references in v2).

**Action category**:
Two top-level categories: `Notification` (channels: Telegram today, schema extensible for email / slack / webhook / in-app) and `StateMutation` (`SetSymbolState`, `SetGlobalState`, `RemoveSymbolState`, `RemoveGlobalState`). Cascade re-entry: state mutations emit cascaded state-change events that re-run the orchestrator within the same tick under the cycle guard.

**Notification action**:
Single `ActionKind = 'notification'` with a `channel` discriminator (`'telegram'` today). Telegram payload: `{ destinationName, template }`. New channels add new payload shapes under the same kind without touching the engine. The existing telegram-destinations port and `/config/notifications/telegram` API surface stay.

### Rule engine — operators

**Comparison operators**:
Binary, snapshot. `>`, `<`, `>=`, `<=`, `==`, `!=`. Both operands resolve to their latest value; no history.

**Crossing operators**:
Binary, series-aware. `Crossing`, `CrossingUp`, `CrossingDown`. Lookback-past-flats semantics: walk backward through the left operand's native timeline skipping points where left == right; fire when the historical baseline came from the opposite side of the boundary. Equality at the boundary doesn't poison the test.

**Channel operators**:
Ternary, series-aware. `EnteringChannel`, `ExitingChannel`, `InsideChannel`. Upper and lower bounds are full operands (literal, indicator, OHLCV, etc.). Same lookback-past-flats walk as crossing but skips points sitting on either boundary; fire when the baseline was strictly outside (Entering) or strictly inside (Exiting).

**Moving operators**:
Unary + scalar tuple, series-aware. `MovingUp`, `MovingDown` (absolute), `MovingUpPercent`, `MovingDownPercent`. Parameters: a scalar literal threshold (number or %) and an integer `lookbackBars`. Compares the operand's current value to its value `lookbackBars` ago on the row's `Interval`.

**State operators**:
`Equals`, `NotEquals`, `ChangesTo`, `ChangesFrom`. Carry forward from today as-is.

**Bool-operand shortcut**:
When a single operand resolves to `Bool` (e.g. an indicator state-key declared as boolean), the UI hides the operator + RHS rows; the engine still stores the condition as `Equals(operand, Literal(true))`. One operator union, no new operator kind.

**Price**:
The live tick price for a symbol. Sole source: `QuoteStreamService` (per Q1). Operand kind in the rule engine; replaces the legacy `CurrentValue`. Tick-axis; no `Interval` needed when referenced.
_Avoid_: current, current-value, last-price (the name is `Price` everywhere — engine, schema, logs, UI).

**Operand catalog**:
Exactly 10 left-hand kinds: `Price`, `Open`, `High`, `Low`, `Close`, `Volume`, `IndicatorRef`, `SymbolStateRef`, `GlobalStateRef`, plus `Literal` (right-hand only). `Open` / `High` / `Low` / `Close` / `Volume` and `IndicatorRef` require the row's `Interval` to disambiguate the bar period. `Price` and the state-refs don't.

**Indicator operand binding**:
A rules indicator operand references a profile-attached indicator instance by `instanceId`. The condition row's `Interval` selector filters the instance picker to instances computed on that period — the user picks the period first, then the matching Supertrend instance.
_Avoid_: inline-parameterized indicators on the condition row (rejected at design time; rules can only reference instances the profile has already attached).

### Rule engine — history

**Series**:
The ordered history of one operand axis (tick prices for a symbol; bar OHLCV on a period for a symbol; an indicator-instance state-key on a period for a symbol). Series-aware operators (`Crossing`, `Entering channel`, `Moving`) read series; snapshot operators (`>`, `<`, …) read only the latest value.

**Series source**:
Bar series are read live from the candle repository (already persisted; no duplication). Tick series are kept in an in-memory ring buffer per symbol (lost on restart; ticks are ephemeral by nature). Indicator series are kept in-memory and recomputed from the bar series on startup via the `IndicatorService`.

**Series alignment**:
When a series-aware operator (`Crossing`, `Entering channel`, `Moving`) compares two operands at different sample rates, the walk happens on the **left operand's native timeline**. The right operand is resampled at each left point as "latest observed value as of this timestamp" (step-function between updates). Operand order is therefore semantically meaningful: `Price Crossing Supertrend.UpTrend on 1h` walks the tick timeline; `Supertrend.UpTrend on 1h Crossing Price` walks the 1h bar timeline.

### Rule engine — event channels

**Evaluation trigger event**:
An event that drives a rule re-evaluation. The four kinds: tick, `BarOpened`, `BarClosed`, periodic timer. Cascaded state-change events count as evaluation triggers too.
_Avoid_: trigger event (overloaded with `Trigger` the gating policy).

**Data update event**:
An event that mutates the engine's lookup caches but does NOT drive re-evaluation on its own. The current per-axis `*ValueChanged` family (`OpenValueChanged`, `HighValueChanged`, etc.) sits here under the new model. State / indicator changes are dual-role: they're both cache updates and cascade triggers.

**BarOpened**:
Evaluation trigger emitted by `PollingService` (and backfill) when a new bar of a given `Period` is first observed for a symbol. Carries `(symbolId, period, ts)`.

**BarClosed**:
Evaluation trigger emitted when a bar of a given `Period` transitions to `final` (the underlying candle closes). Carries `(symbolId, period, ts)`.

### Rule engine — triggers

**Every time**:
Trigger granularity = tick. Re-evaluate the rule on every inbound tick; no fire throttle.

**Once**:
Trigger granularity = tick. Re-evaluate on every tick; on the first matching evaluation, auto-disable the rule (one fire for its lifetime). No interval — operand-axis bar periods are carried on each condition individually.

**Once per bar**:
Trigger granularity = tick. Same first-match-wins shape as `Once`, but the latch scope is a single bar of the trigger's selected period (e.g. 1m) instead of the rule's lifetime. First matching tick fires; further checks are suppressed until the next bar of that period opens, at which point the latch re-arms. The rule itself stays enabled.
_Avoid_: per-bar (overloaded — `Once per bar` is tick-cadence with a bar-aligned latch, not a per-bar cadence).
Carries an `interval` (bar period) on the trigger payload — the only per-tick trigger that does.

**Once per bar open**:
Trigger granularity = bar. Fires once when the bar of a given period opens.

**Once per bar close**:
Trigger granularity = bar. Fires once when the bar of a given period closes (final).

**Once per interval**:
Trigger granularity = periodic. Fires once per fixed wall-clock duration (e.g. every 5 minutes). Independent of bar periods and tick arrival.
_Avoid_: per-minute (the existing `OncePerMinute` is a different concept — a false→true-transition throttle); per-bar interval (the duration is wall-clock, not a `Period`).
