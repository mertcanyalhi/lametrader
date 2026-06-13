# Spec: explicit Binance period mapping

- Status: approved
- Touches: `engine` (`BinanceMarketDataSource.fetchCandles`).

## Goal

Remove the silent `period as string` coupling in the Binance adapter, where the
domain `Period` enum value was passed straight through as a Binance kline
`interval`. The fact that today's enum values happen to equal Binance's interval
strings is a coincidence, not a contract: a future `Period` Binance spells
differently (or does not offer) would be sent as a bogus interval with no type or
runtime error. Mirror the explicit mapping the Yahoo adapter already uses.

## Acceptance criteria

- `fetchCandles` maps each supported `Period` to its Binance kline interval via an
  explicit table (not a cast).
- `fetchCandles` for a `Period` the table has no entry for throws `CandleError`
  (`Binance does not support period <p>`) **before** any network request.
- Supported periods continue to fetch unchanged (existing upstream-failure
  behaviour and the live contract are preserved).
