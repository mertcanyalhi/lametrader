# Spec: per-minute timer event source

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/minute-timer-source.ts`).

## Goal

Per-minute timer event source for the rule engine that emits one `TimerEvent` per wall-clock minute boundary.
Uses a chained `setTimeout` (not `setInterval`) so a delayed callback never leads to "make-up" overlapping fires — at most one fire is ever pending, and each fire schedules the next one only after it lands.

## Acceptance criteria

- [ ] Starts after a partial minute and fires once at the next minute boundary.
- [ ] Fires exactly once per minute across multiple consecutive boundaries.
- [ ] A delayed tick does not produce a backlog of catch-up fires — only one pending fire is ever queued.
- [ ] `start()` is idempotent — a second call does not arm an additional timer.
- [ ] `stop()` prevents any further fires.
- [ ] `stop()` is idempotent — calling it twice does not throw.
