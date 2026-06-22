# Spec: prev/current cache for stream values

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/prev-current-cache.ts`).

## Goal

A tiny stateful helper that remembers the last value seen at every `(symbolId, period, key)` slot.
Used by the stream bridges to decorate each inbound event with `prev` + `current` — the missing piece operators like `crossing` and `changes-to` need, because the upstream quote / candle / indicator streams emit current values only.

## Acceptance criteria

- [ ] The first `record(...)` to a slot returns `{ prev: null, current }`.
- [ ] A subsequent `record(...)` to the same slot returns the previously written value as `prev` alongside the new `current`.
- [ ] Slots are isolated by `symbolId` — writing to a different symbol returns `prev: null`.
- [ ] Slots are isolated by `period` — writing to a different period for the same symbol returns `prev: null`.
- [ ] Slots are isolated by `key` — writing to a different key for the same symbol and period returns `prev: null`.
