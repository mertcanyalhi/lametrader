# 0007. Segregate MarketDataSource into discovery and candle-feed ports

- Status: accepted
- Date: 2026-06-13

## Context

`MarketDataSource` bundled discovery (`search`, `lookup`, `types`, `periods`) with
candle fetching (`fetchCandles`). The backfill spec accepted this as
"ISP-acceptable" because one provider owns both. But the consumers use disjoint
slices: `SymbolService` calls `search`/`lookup` and reads `types`/`periods` (to
discover and validate a watch) and never `fetchCandles`; `BackfillService` calls
`fetchCandles` and reads `types` and never the discovery methods. A fat port let
either use-case reach methods irrelevant to it, and forced every future source to
implement both halves even when only one is meaningful (e.g. a symbol directory
with no candle history).

## Decision

Split the port along the consumer seam (ISP):

- `SymbolDiscovery` — `types`, `periods`, `search`, `lookup`.
- `CandleFeed` — `types`, `fetchCandles`.
- `MarketDataSource = SymbolDiscovery & CandleFeed` — the shape every concrete
  adapter still implements, and what the composition root wires.

`SymbolService` depends on `SymbolDiscovery[]`, `BackfillService` on `CandleFeed[]`.
`sourceForType` became generic over `{ types }`, so both resolve a source from the
same rule. `periods` sits on `SymbolDiscovery` because that is where it is consumed
(watch-time capability validation), not on the feed.

This supersedes the backfill spec's "one adapter, ISP-acceptable" note.

## Consequences

- Each use-case can only reach the methods it needs; a discovery-only or feed-only
  provider can implement just one port. Adapters are unchanged — they implement the
  intersection as before.
- Cost is one type alias and a generic resolver — no new classes, no runtime
  indirection. The shared contract test still exercises the full `MarketDataSource`.
