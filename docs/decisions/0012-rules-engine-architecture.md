# Rules engine architecture: timestamp-per-event, cascading with cycle-limit, embedded runtime state

- Status: superseded by 0016

## Context

The rules engine (parent issue #91) needs to react to live market events, evaluate condition trees against current and historical values, fire actions (state writes, notifications), and feed state changes back into the same evaluation pass so a downstream rule can react in the same tick.

Three design choices fork the rest of the work and aren't obvious from the spec alone:

1. **Where does the clock live?**
   The evaluator needs to know "when" each event happened — for `OncePerBar` gating, for the `timestamp` template variable, for the persisted `lastFiredAt`.
   Reading `Date.now()` inside the evaluator works for live mode but forks the code path the moment a backtest needs to replay historical candles with synthetic timestamps.

2. **How do action-produced state changes propagate?**
   A rule that sets `state.trend = 'up'` should be able to immediately fire a downstream rule that conditions on `state.trend == 'up'`.
   Without a feedback loop they don't compose; with an unbounded loop they hang.

3. **Where do rule events live?**
   The spec describes embedded `events` arrays on the rule and on each symbol.
   The alternative is a standalone `rule_events` collection indexed by `ruleId` and `symbolId`, which scales better but diverges from the spec wording and adds a second source of truth for the same data.

4. **Where does the `OncePerMinute` firing-state latch live?** (added 2026-06-27, #279)
   The trigger gate needs a per-`(ruleId, symbolId)` "currently active" bit so it can detect false → true transitions across restarts.
   The first cut put it in its own `firing_state` collection keyed by a compound `_id`.
   That left two cleanup call-sites (`RuleService.remove`, `ProfileService.remove` → `removeForProfile`) and a second source of truth for what's really internal trigger plumbing — the orchestrator and gate are the only readers.

## Decision

**1. Every `RuleEvent` carries its own `ts`.**
The evaluator never reads `Date.now()`; the orchestrator never calls a clock port either.
The timestamp travels with each inbound event (timer ticks, OHLCV changes, indicator updates, state changes) and is the only "now" the engine sees.
Live mode passes the wall-clock; backtests pass the candle's own timestamp.
The engine doesn't need to know which mode it's in.

**2. State-change events re-enter the engine in the same tick, bounded by a cycle-limit guard.**
When an action writes to the state store, the resulting `change:symbol_state` / `change:global_state` event is enqueued and processed in the same evaluation pass (after the rule that produced it).
A `CycleGuard(limit)` counts entries per tick.
Hitting the limit halts the cascade and emits one `cycle_overflow` error event on the offending rule + affected symbol; the next external event resets the counter.
Default limit is **4** — large enough for realistic cascades, small enough to surface accidental loops fast.

**3. Rule events live as embedded arrays on the rule and symbol documents.**
Each fired event is appended both to `Rule.events[]` and to the affected `Symbol.events[]`.
Reads for "events for this rule" and "events for this symbol" are single-document fetches.
Pagination uses `before` cursors on the event `ts`.

**4. The `OncePerMinute` firing-state latch lives as an embedded sub-doc map on the rule.** (added 2026-06-27, #279)
`Rule.firingState?: Record<symbolId, boolean>` — optional, defaults to `false` for any unset key.
The Mongo `FiringStateRepository` reads and writes the dotted path `firingState.{symbolId}` on the `rules` collection: projected `findOne` for reads, `$set` for writes so two symbols on the same rule never replace each other's slot.
The standalone `firing_state` collection is dropped; the explicit `removeByRule` cascade goes away with it.
The port survives — the orchestrator and gate stay decoupled from storage — but loses `removeByRule`.
The field is marked optional and is intentionally absent from `RuleSchema`, so Fastify strips it from API responses (internal plumbing, not user-facing state).

**5. The orchestrator runs across every enabled profile by default and treats `Profile.enabled === false` as a runtime kill-switch.** (added 2026-06-27, #290)
There is no `getActiveProfileId` / "active profile" concept; the option is dropped from `RuleOrchestratorOptions`.
On every non-cascade event, `RuleRepository.listEnabledForSymbol(symbolId)` returns every rule whose own `enabled` is true AND whose parent profile's `enabled` is true.
Cascaded `SymbolStateChanged` / `GlobalStateChanged` events still scope by `event.profileId` (per the #281 partitioning) — they call `listEnabledForSymbol(symbolId, event.profileId)`.
Profile-level disable thus stops the entire child rule set from firing on live events; re-enable resumes them on the next tick.

**6. Cascade failures emit a synthetic `Error` rule event on the affected symbol, with `ruleId: ''` as the sentinel.** (added 2026-06-27, #290)
When `orchestrator.process(event)` rejects, the chain's cascade error handler:

  1. Logs the primary error via the injected logger (Pino-shaped: `log.error({ err, event }, 'rule orchestration failed')`).
  2. If the rejecting event carries a `symbolId`, appends one `Error` entry to that symbol's `events[]` via `EventLog.appendSymbolEvent`, with `ruleId: ''` (matching the existing `CycleOverflow` convention for orchestrator-level events that have no single owning rule) and `reason: 'rule orchestration failed: <err.message>'`.
  3. Wraps the synthetic-event write itself in a try/catch — if writing the `Error` event also throws, the secondary failure is logged but never re-thrown.

The `Error` entry surfaces in the existing chart Events dialog (which already renders `RuleEventType.Error` via `event.reason`), so a user sees engine-level failures without leaving the chart.
The serialized rule chain in `wireRuleEngine` extends a `pending` promise with each inbound event; the cascade handler's `.catch` keeps the chain alive past failures so the next event still processes.
The same logger pattern is applied to the polling fan-out's previously-`void` indicator/quote stream calls — no silent error swallows remain.

## Consequences

**Timestamp-per-event**

- Backtesting needs no engine changes — replaying candles with their own timestamps is the whole story.
- The pure evaluator is trivially testable: tests construct events with explicit timestamps, no fake clock needed.
- Streams that don't natively carry a timestamp (none today) would need one decorated on; this is a constraint on every new event source, called out in the `RuleEvent` types.

**Cascading with cycle-limit**

- Two rules that legitimately chain (`A sets state.x → B reads state.x → fires`) compose without an extra orchestration layer.
- A pair of rules that set each other's state can't hang the engine; the guard catches them and surfaces the cycle as data the user can see in the events list (no silent failure, no log-only error).
- The default limit (4) is settable per-engine-instance for users with deep legitimate cascades.
- Cascading is bounded to one tick — a rule can't queue work for a future tick by writing state.
  If asynchronous follow-up is ever needed (a delayed action, a scheduled re-evaluation), it'll need its own primitive, not this pass.

**Embedded events**

- One document read covers a rule's full event history or a symbol's full event history — no join, no cross-collection cursor.
- Document size grows over time; the single-tenant scope of this app makes that acceptable for the foreseeable future.
  When it stops being acceptable, the read API stays the same and we migrate to a `rule_events` collection behind it.
- Rule delete cleans up its embedded events in one operation; symbol delete the same.
  No orphan-cleanup job needed.
- Events are mirrored on two documents (rule + symbol), so an event write is two updates.
  Mongo doesn't guarantee these atomically; an interleaved failure between writes leaves one side missing an entry.
  Acceptable for an events log (where occasional gaps don't change correctness) and called out in the event-append helper.

**Embedded firing-state** (added 2026-06-27, #279)

- Rule delete and the profile-delete cascade clean up the latch implicitly — no separate code path, no chance of orphaned firing-state docs lingering when a cascade misses a step.
- A `RuleService.replace` race that wrote the rule between an orchestrator read and write would now overwrite the latch.
  `replace` preserves `existing.firingState` on the in-memory `Rule` passed to `save`, which contains the read-side bit; the standing load → save window is the same one accepted for `events[]` and `history[]`.
- Latch growth shape matches `events[]`: `Symbol`-scoped rules carry exactly one entry; `AllSymbols`-scoped rules carry one per watched symbol.
- The shared contract test for the port now seeds rule docs upfront — Mongo's `$set` targets an existing doc (no `upsert`, which would create orphan rules); the in-memory adapter ignores the ids.
- Migration: orphan documents in the pre-existing `firing_state` collection can be dropped — they were only ever a per-`(rule, symbol)` cache.
  No data loss; the gate's worst case after the cutover is one spurious or one missed transition on the first evaluation after restart, the same window the system already tolerates between writes.

**Multi-profile fire + `Profile.enabled` kill-switch** (added 2026-06-27, #290)

- Disabling a profile is a one-flag operation: a single `PATCH /profiles/:id { enabled: false }` stops every child rule from firing on the next tick, without touching the rules themselves.
- The orchestrator stays stateless about "which profile is active" — multiple profiles legitimately fire in parallel against the same live event (e.g. a long-term-trend profile and a short-term-scalper profile both watching `AAPL`).
- `RuleRepository.listEnabledForSymbol` is the single read path with both kill-switches baked in; CRUD listings still go through `listForSymbol` and return all rules (enabled or not).
- The shared contract suite now hands `(repo, profiles)` pairs to its tests; both the in-memory and the Mongo `RuleRepository` constructor accept an optional `ProfileRepository` (omitting it reads every profile as enabled, preserving back-compat for existing call sites).

**Cascade error pattern** (added 2026-06-27, #290)

- A failure inside `orchestrator.process` no longer poisons the rule chain — the next inbound event still processes because `pending = pending.then(orchestrator.process).catch(handleCascadeError)`.
- The user sees engine failures in the same chart Events dialog they use to verify the rule fires — no new UI surface; existing `events-dialog.tsx` renders `RuleEventType.Error.reason`.
- The recursive-write guard (try/catch around the synthetic-event write) means a full Mongo outage produces exactly one log line per failed event and zero exceptions in the polling fan-out.
- The injected `logger` lets test code observe the failure structurally (`logger.error.mock.calls`) and production code emit through Fastify's Pino instance; the no-op default keeps the engine optional-dep-free.

## Closes

#98, #279, #290.
