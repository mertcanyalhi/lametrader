# Spec: Yahoo lookup distinguishes not-found from upstream failure

- Status: approved
- Touches: `engine` (`YahooMarketDataSource.lookup`).

## Goal

`YahooMarketDataSource.lookup` currently does `catch { return null }`, so any
failure — a network outage, a Yahoo 5xx, a rate-limit — is reported as "this
symbol does not exist". On `POST /symbols` that surfaces as a 404, presenting a
transient infrastructure failure as the authoritative fact that the symbol is not
real. `fetchCandles` already wraps provider failures in `MarketDataError` (→ 502);
`lookup` should be consistent.

`yahoo-finance2` throws an `HTTPError` carrying `code = response.status`. A client
status (4xx) means Yahoo rejected the symbol (genuinely not found); a server
status (5xx), a rate-limit, or any error without an HTTP status is transient.

## Acceptance criteria

- `lookup` returns `null` when Yahoo returns a quote with no `regularMarketPrice`
  (unchanged — Yahoo's shell-quote not-found signal).
- `lookup` returns `null` when the client throws an error whose HTTP `code` is a
  4xx (Yahoo rejected the symbol).
- `lookup` throws `MarketDataError` (carrying the cause) when the client throws an
  error with a 5xx `code`, or any error with no HTTP status (network/timeout).
- `fetchCandles` behaviour is unchanged.
