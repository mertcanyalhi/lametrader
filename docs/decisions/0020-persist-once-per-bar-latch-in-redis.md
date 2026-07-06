# Persist the OncePerBar latch in Redis

- Status: accepted

## Context

The `OncePerBar` trigger gate was an in-memory `Set` in `TriggerDispatcher` (`oncePerBarLatch`, keyed `<ruleId>|<symbol>|<period>`).
Because it lived in process memory it had two failure modes (issue #513):

- **Restart re-fires within the same bar** — a process restart wiped the latch, so a `OncePerBar` rule that already fired this bar could fire again after the restart.
- **Not horizontally scalable** — two backend instances each kept their own latch, so the same rule fired once *per instance* per bar.

By contrast `Once` already persists its gate durably (it flips `enabled: false` in Mongo via `claimOnceFire`), so it survives restart; `OncePerBar` did not.

The latch is a short-lived presence marker: it only matters within its bar, is created on fire, and is cleared when the next bar opens.
A persistent store for it wants native per-key TTL (so a missed `BarOpened` or a crashed instance can never wedge it) and cheap presence checks — not the durability, indexing, or query surface of the primary datastore.

The store choice was left open in #513 and flagged ADR-worthy because it touches infra: Redis (a natural fit, but not in the stack) versus Mongo (no new infra, reuses the existing connection, mirrors `claimOnceFire`).

## Decision

Persist the `OncePerBar` latch in **Redis**, behind a new `OncePerBarLatchStore` port with a Redis adapter (production) and an in-memory fake (unit tier), proven identical by a shared contract.

- **Key** `latch|<ruleId>|<symbol>|<period>`; presence is the latch.
- **Gate check** — `EXISTS` (replaces `Set.has`).
- **Record fire** — `SET … PX <periodMillis(period)*2> NX` (replaces `Set.add`); the TTL is ~one bar plus slop, a self-cleaning backstop with no cleanup path to maintain.
- **Re-arm on `BarOpened(symbol, period)`** — clear every rule's latch for that `(symbol, period)` (replaces the in-memory suffix sweep).
  A sibling `latch-idx|<symbol>|<period>` Set records the latched rule ids so the re-arm is `UNLINK` over the set members, not a keyspace `SCAN`.

The dispatcher's gate (`gateAllows` / `recordFire` / the `BarOpened` re-arm) becomes `async` to await the store.
`OncePerInterval`'s last-fire map stays in memory: its gate is an event-time comparison (`event.ts - lastFireTs >= intervalMs`), not a presence latch, so it does not reduce to the `EXISTS`/TTL model — persisting it is a separate follow-up.

## Considered Options

**Redis (chosen).**
Native per-key TTL and atomic `SET NX` are the idiomatic fit for an ephemeral, self-expiring presence latch, and it keeps disposable latch data out of the primary datastore.
It also positions the platform for the horizontal-scaling failure mode #513 names.
Cost: Redis was not in the stack — this adds the `ioredis` dependency, a `redis` service to the compose infra (the default no-profile bring-up is now Mongo + Redis), a Redis Testcontainer to the e2e tier, and a `REDIS_URL` setting.

**Mongo (rejected).**
Would add no new infra — a small TTL-indexed collection reusing the existing connection, mirroring how `Once` persists its gate.
Rejected because it folds a disposable, high-churn TTL cache into the primary store and leans on Mongo's ~60-second-granularity TTL monitor; Redis is the idiomatic home for a TTL'd presence latch and the infra cost is one small, standard service.

## Consequences

- **New infra dependency.** Redis must be reachable for the rule engine to gate `OncePerBar`. `REDIS_URL` is validated at boot (default `redis://localhost:6379`); compose and the e2e Testcontainers setup both provision it.
- **The gate is now I/O.** Each `OncePerBar` gate check/record is a Redis round-trip (sub-millisecond against a co-located Redis). The dispatcher gate methods went `async`; all construction sites now inject a latch store.
- **Cross-instance once-per-bar is best-effort.** The `EXISTS` + `SET NX` design has a narrow TOCTOU between the gate check and the record; the per-symbol serializer removes it within a single instance. A strict cross-instance test-and-set (a Lua CAS) is deferred until multi-instance is actually run.
- **Latch data is disposable.** The Redis service runs without a volume: latches auto-expire, and a Redis restart is covered by the TTL plus the `BarOpened` re-arm. The latch's job is to survive a *server* restart, which it does out-of-process.
