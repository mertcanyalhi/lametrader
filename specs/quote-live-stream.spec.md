# Spec: live quote stream over /stream

- Status: draft
- Touches: `core` (`SymbolQuoteEvent` type + `SymbolQuoteListener`), `engine` (`QuoteStreamService` under `symbols/`, `connectServices` wiring + `ConnectedServices.quoteStream`), `api` (`QuoteStreamHub`, `/stream` controller `subscribe-quote`/`unsubscribe-quote`, `LiveStream` bundle), `api` README.

## Goal

Tick watchlist quotes live: extend the `/stream` WebSocket with a quote subscription that pushes server-derived `{ price, change, changePct, time }` frames per symbol as candles arrive.
The live counterpart to #35 — same domain shape, transport-agnostic engine (ADR-0005), symmetric with indicator streaming.
The snapshot from `?enrich=true` (#35) provides each subscription's initial `previousClose` baseline; the browser renders, never derives.

## Design notes

- The engine reuses #35's pure `computeQuote(latest, previous)` to derive each frame and the "latest two candles on `defaultPeriod`" path to seed the baseline.
- A subscription holds the rolling **previous (closed) bar**; its `close` is the baseline `computeQuote` measures change against.
  On a `final: true` candle event, after emitting that frame, the subscription rotates the previous bar to the just-closed candle, so subsequent frames measure against it (the last-bar snap-back, matching the snapshot semantics).
- `handleCandle` is synchronous — derivation is pure (no candle load at tick time), unlike indicator streaming which recomputes over stored candles.
- `SymbolQuoteEvent.quote` is exactly `computeQuote`'s output `{ price, change, changePct, time }` (no `period` inside); `period` is a top-level field of the event, mirroring how `IndicatorStateEvent` keeps `period` out of its `state`.
  The #35-consistency criterion compares these shared fields against the snapshot's `SymbolQuote`.

## Acceptance criteria

`QuoteStreamService` (in-memory repos, real `computeQuote`):

- [ ] `subscribe` for a valid symbol returns the generated `subscriptionId`.
- [ ] `subscribe` for an unwatched symbol throws `SymbolNotFoundError` (no subscription opened).
- [ ] `subscribe` for a symbol that does not watch `defaultPeriod` throws `SymbolError` (no subscription opened).
- [ ] `subscribe` for a symbol with `< 2` candles on `defaultPeriod` throws `SymbolError` (no subscription opened).
- [ ] `handleCandle` for a matching `(symbolId, period)` emits one `SymbolQuoteEvent` per subscription whose `quote` is derived via `computeQuote(eventCandle, previousBar)`, with `final` mirroring the candle's `final` (full-payload `toEqual`, `closeTo` floats).
- [ ] After a `final: true` candle, the **next** `handleCandle` derives against the rotated previous bar (the just-closed candle's close) — rollover regression.
- [ ] `handleCandle` with no matching subscription emits nothing.
- [ ] `unsubscribe(subscriptionId)` stops further emissions for that subscription only.
- [ ] Consistency with #35: a `final: true` frame at a closed candle's `time` carries the same `price`/`change`/`changePct`/`time` as `SymbolService.listWithQuotes` (the `?enrich=true` snapshot) for that symbol at that moment.

`QuoteStreamHub` (`api`, mirrors `IndicatorStreamHub`):

- [ ] Fans an event to every subscriber of its `subscriptionId`.
- [ ] Only delivers events for the subscribed `subscriptionId`.
- [ ] Stops delivering after unsubscribe.
- [ ] Publishing with no subscribers is a no-op.

`/stream` route extensions:

- [ ] `subscribe-quote` replies with an ack frame `{ action: 'subscribed-quote', subscriptionId, id, period }`; subsequent quote frames reach this socket only, not others.
- [ ] `unsubscribe-quote` stops frames for that subscription only.
- [ ] Malformed `subscribe-quote` → `{ error }` frame, no subscription opened.
- [ ] Socket close releases every quote subscription on it (the engine's subscription map shrinks).

E2E (`packages/api/tests/e2e/quote-stream.e2e.test.ts`):

- [ ] Real Mongo + real `PollingService` + stub source: backfill on `defaultPeriod`, open `/stream`, `subscribe-quote`, one polling sweep → a quote frame whose `price` = the new candle's close, `change`/`changePct` reflect the prior close, `final` mirrors the candle's `final`.
- [ ] Failure mode: `subscribe-quote` for a symbol with no `defaultPeriod` data → `{ error }` frame, no subsequent frames.

## End-to-end expectation

Backfill BTC on `defaultPeriod`, subscribe-quote over `/stream`, run one poll that introduces a new candle: the socket receives a quote frame with the new close as `price` and `change` against the prior close.
Critical failure mode: subscribing a symbol with no `defaultPeriod` data yields an `{ error }` frame and no quote frames.

## Out of scope

- The watchlist page UI.
- Quoting non-`defaultPeriod` series, volume tick, intraday open, multi-period quotes.
- Profile-bound quote subscriptions.

## Surprises

(filled in retroactively)
