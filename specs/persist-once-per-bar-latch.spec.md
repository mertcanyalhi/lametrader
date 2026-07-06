# Spec: persist the OncePerBar latch (Redis)

- Status: approved
- Touches: `TriggerDispatcher` (dispatch gate), a new `OncePerBarLatchStore` port + Redis adapter + in-memory fake, `wireRuleEngine` / `RuleEngineService` / `AnalyticsModule` wiring, `AppConfig` (`redisUrl`), infra (docker-compose Redis).

## Goal

The `OncePerBar` gate is an in-memory `Set` in `TriggerDispatcher`, so a process restart re-fires a rule within the same bar and two instances each fire once *per instance* per bar.
Persist the latch out-of-process in **Redis** (the store chosen for issue #513; ADR-0020) with a TTL of `periodMillis(period) * 2` so it survives restart and is shared across instances, while preserving the existing gate semantics — per-`(ruleId, symbol, period)` keying and re-arm driven by an **explicit** `BarOpened(period)`, not by a tick merely crossing a bar boundary.
`OncePerInterval` is deliberately left in memory (its timestamp-compare semantics don't reduce to a presence latch — separate follow-up).

## Acceptance criteria

Each bullet maps to exactly one test.

### `OncePerBarLatchStore` contract — run against **both** the in-memory fake and the Redis adapter

- [ ] `isLatched` returns `false` for a `(rule, symbol, period)` that was never latched.
- [ ] After `latch(rule, symbol, period, ttl)`, `isLatched(rule, symbol, period)` returns `true`.
- [ ] The latch is per-rule: after `latch(r1, symbol, period, ttl)`, `isLatched(r2, symbol, period)` is `false`.
- [ ] `rearm(symbol, period)` clears the latch for that `(symbol, period)` — `isLatched` returns `false` afterwards.
- [ ] `rearm(symbol, period)` leaves a latch for a **different symbol** of the same period intact.
- [ ] `rearm(symbol, period)` leaves a latch for a **different period** of the same symbol intact.

### `TriggerDispatcher` gate — reads/writes the injected store (unit, via the fake)

- [ ] A fresh dispatcher whose injected store **already holds** the latch (a simulated restart) does **not** fire the `OncePerBar` rule on a matching tick in the same bar.
- [ ] After `rearm` clears the shared store, a fresh dispatcher **does** fire the `OncePerBar` rule on the next matching tick.
- [ ] The existing `OncePerBar` behaviours (first-tick fires, second-tick suppressed, `BarOpened(period)` re-arms, other period / other symbol do not re-arm) stay green routed through the injected store.

### Config

- [ ] `validateEnv` defaults `redisUrl` to `redis://localhost:6379` when `REDIS_URL` is unset.
- [ ] `validateEnv` reads `redisUrl` from `REDIS_URL` when set.

## End-to-end expectation

Against a real Redis (Testcontainers): a `OncePerBar` rule fires on the first tick of a bar; a **second dispatcher** built over a fresh store instance sharing the same Redis (a restart) is suppressed on the next tick of that same bar — proving the latch survived out-of-process.
Critical follow-through: after an explicit `BarOpened(period)` re-arm on the shared Redis, the restarted dispatcher fires again.
The contract suite additionally runs end-to-end against the Redis adapter to prove it is behaviour-identical to the in-memory fake.

## Out of scope

- Folding `OncePerInterval`'s last-fire map into the store (its `event.ts - lastFireTs >= intervalMs` compare is not a presence latch; deferred).
- A strictly-atomic cross-instance test-and-set (Lua CAS). The issue's `EXISTS` + `SET NX` design tolerates the narrow TOCTOU; the per-symbol serializer removes it within one instance.
- Deterministic tests of TTL expiry (a Redis background-thread, minutes-scale concern). The TTL is a backstop; the explicit `BarOpened` re-arm is the tested mechanism.

## Surprises

_(filled in retroactively)_
