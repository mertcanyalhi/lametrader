# Spec: MongoDB candle index

- Status: approved
- Touches: `engine` (`MongoCandleRepository.ensureIndexes`, composition root).

## Goal

`MongoCandleRepository` stores each candle keyed by a compound `_id` object
`{ s, p, t }` and queries dotted subfields (`_id.s`, `_id.p`, `_id.t`). Mongo's
automatic `_id` index keys the **whole** embedded document, so it does not serve
dotted-subfield equality/range predicates: `range`, `latest`, and `deleteSymbol`
fall back to full collection scans. For a candle store this is the workload's hot
path.

Add a secondary compound index `{ '_id.s': 1, '_id.p': 1, '_id.t': 1 }`, created
at composition time. It serves every read:

- `range` — equality on `s`,`p` + range on `t`, ascending sort on `t`.
- `latest` — equality on `s`,`p`, descending sort on `t` (index walked in reverse).
- `deleteSymbol` — equality on `s` (index prefix).

## Acceptance criteria

- `MongoCandleRepository.ensureIndexes()` creates the compound index
  `{ '_id.s': 1, '_id.p': 1, '_id.t': 1 }` and is idempotent (safe to call repeatedly).
- The composition root (`connectServices`) calls `ensureIndexes()` while wiring,
  so production always has the index.
- E2E: after `ensureIndexes()`, the `candles` collection reports an index over
  `_id.s`, `_id.p`, `_id.t`; the existing candle-repository contract still passes.
