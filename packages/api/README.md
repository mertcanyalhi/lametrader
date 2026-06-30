# @lametrader/api

REST API (Fastify) over the engine use-cases.

## Running

```sh
npm run infra:up   # start MongoDB
npm run build      # compile the workspace
npm run api        # serve on PORT (default 3000)
```

### Settings

Resolved from the environment (with defaults) via the engine settings layer:

| Variable         | Default                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| `MONGODB_URI`    | `mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin` |
| `PORT`           | `3000`                                                                        |
| `POLL_INTERVALS` | per-period poll cadence (ms) — see [Live stream](#live-stream)                |

On startup the API begins **continuously polling** new candles for every watched
symbol+period and streaming them over WebSocket (see below). Polling resumes after a
restart from the latest stored candle, so a backfill should run first.

## API documentation

Interactive OpenAPI docs (Swagger UI) are served at `/docs`; the raw spec is at
`/docs/json`.

## Configuration resource

### Fields

- **`periods`** — the supported periods. Each value must be one of:
  `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`.
- **`defaultPeriod`** — the period shown by default. Must be one of `periods`.

Defaults, when nothing has been stored yet:

- `periods`: `1h`, `1d`
- `defaultPeriod`: `1d`

### Endpoints

| Method  | Path      | Body                            | Description                       |
| ------- | --------- | ------------------------------- | --------------------------------- |
| `GET`   | `/config` | —                               | Return the current config.        |
| `PUT`   | `/config` | `{ periods, defaultPeriod }`    | Full replace (both required).     |
| `PATCH` | `/config` | `{ periods?, defaultPeriod? }`  | Partial merge over the current.   |

Responses:

- **200** — the current/updated config.
- **400** — validation failed; body is `{ "error": "<reason>" }`.

### Examples

Read the current config:

```sh
curl http://localhost:3000/config
```

Replace it entirely:

```sh
curl -X PUT http://localhost:3000/config \
  -H 'content-type: application/json' \
  -d '{ "periods": ["1h", "4h", "1d"], "defaultPeriod": "4h" }'
```

Change just the default period:

```sh
curl -X PATCH http://localhost:3000/config \
  -H 'content-type: application/json' \
  -d '{ "defaultPeriod": "1h" }'
```

Notification destinations (Telegram for now) live as a sub-resource under
`/config/notifications/*` and are documented in the OpenAPI spec at `/docs`.

## Symbols resource

Discover instruments and manage the watchlist. Canonical ids are `<type>:<ticker>`
(`crypto`, `stock`, `fund`, `fx`), e.g. `crypto:BTCUSDT`. Crypto is served by
Binance; stocks/funds/FX by Yahoo. A watched symbol's `periods` default to the
config's `periods` and must be a subset of them.

An instrument carries `{ id, type, description, exchange, currency? }`. `currency`
is present from Binance and from a Yahoo lookup, but absent from Yahoo *search*
results (so a discovery hit may omit it; a watched symbol always has it).

### Endpoints

| Method   | Path                  | Body                    | Description                                         |
| -------- | --------------------- | ----------------------- | --------------------------------------------------- |
| `GET`    | `/instruments?q=&type=` | —                     | Discover instruments (optionally filtered by type). |
| `GET`    | `/symbols?enrich=`    | —                       | List the watchlist; `?enrich=true` attaches a `quote` per symbol. |
| `POST`   | `/symbols`            | `{ id, periods? }`      | Add (validates existence). **201** / 400 / 404 / 409. |
| `PATCH`  | `/symbols/{id}`       | `{ periods }`           | Change a symbol's periods. 200 / 400 / 404.         |
| `DELETE` | `/symbols/{id}`       | —                       | Remove a symbol **and its stored candles**. **204**. |
| `GET`    | `/symbols/{id}/state?profileId=` | —                | Current rule-engine state map for this symbol under `profileId` (state is partitioned per profile; `{ [key]: StateValue }`; `{}` when empty). 200 / 400 / 404. |

Symbol-mirrored rule events live at `GET /symbols/{id}/rule-events` (see the [Rules resource](#rules-resource) section).

Errors use the uniform `{ "error": "<reason>" }` body — **400** for invalid input,
**404** when the symbol doesn't exist at its source or isn't watched, **409** when
re-adding an already-watched symbol (re-adding never changes its periods; use
`PATCH`).

With `?enrich=true`, each item carries a `quote` computed server-side from the
symbol's stored candles on the config's `defaultPeriod` (strictly — no fallback):
`{ price, change, changePct, period, time }`, where `change` is period-over-period
(`latestClose − previousClose`) and `changePct` is `change / previousClose`.
`quote` is **`null`** when the symbol does not watch `defaultPeriod` or has fewer
than two candles stored there. Absent or `?enrich=false` returns the plain list.

### Examples

```sh
curl 'http://localhost:3000/instruments?q=bitcoin&type=crypto'
curl -X POST http://localhost:3000/symbols \
  -H 'content-type: application/json' -d '{ "id": "crypto:BTCUSDT" }'
curl http://localhost:3000/symbols
curl 'http://localhost:3000/symbols?enrich=true'
curl -X PATCH http://localhost:3000/symbols/crypto:BTCUSDT \
  -H 'content-type: application/json' -d '{ "periods": ["1h"] }'
curl -X DELETE http://localhost:3000/symbols/crypto:BTCUSDT
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/state?profileId=p1'
```

## Profiles resource

A **profile** is a named, enable/disable-able template scoped to watched symbols — either all of them (the default) or an explicit subset.
It will later hold indicators and actions.

A profile is `{ id, name, description, enabled, scope, createdAt, updatedAt }`, where `scope` is either `{ "type": "all" }` or `{ "type": "symbols", "symbolIds": [...] }`.
Names are unique.
Every id in a `symbols` scope must be currently watched, and an empty subset normalizes to `all`.

### Endpoints

| Method   | Path             | Body                                       | Description                          |
| -------- | ---------------- | ------------------------------------------ | ------------------------------------ |
| `GET`    | `/profiles`      | —                                          | List profiles.                       |
| `POST`   | `/profiles`      | `{ name, description?, enabled?, scope? }` | Create. **201** / 400 / 409.         |
| `GET`    | `/profiles/{id}` | —                                          | Get one. 200 / 404.                  |
| `PUT`    | `/profiles/{id}` | `{ name, description?, enabled?, scope? }` | Full replace. 200 / 400 / 404 / 409. |
| `PATCH`  | `/profiles/{id}` | `{ name?, description?, enabled?, scope? }` | Partial update. 200 / 400 / 404 / 409. |
| `DELETE` | `/profiles/{id}` | —                                          | Delete. **204** / 404.               |

Errors use the uniform `{ "error": "<reason>" }` body — **400** for invalid input or a scope referencing an unwatched symbol, **404** for an unknown profile, **409** for a duplicate name.

Removing a watched symbol prunes it from every profile's subset.
A profile left with an empty subset is **disabled** (kept symbols-scoped) rather than widened to `all`.

### Examples

```sh
curl -X POST http://localhost:3000/profiles \
  -H 'content-type: application/json' -d '{ "name": "Scalper" }'
curl http://localhost:3000/profiles
curl -X PATCH http://localhost:3000/profiles/<id> \
  -H 'content-type: application/json' -d '{ "enabled": false }'
curl -X PUT http://localhost:3000/profiles/<id> \
  -H 'content-type: application/json' \
  -d '{ "name": "Scalper", "scope": { "type": "symbols", "symbolIds": ["crypto:BTCUSDT"] } }'
curl -X DELETE http://localhost:3000/profiles/<id>
```

### Attached indicators (sub-resource)

A profile holds zero or more **attached indicator instances** — a configured indicator from the catalog with validated input values.
Instances are addressed by a stable id (so actions can reference them later).
The instance carries no period: at compute time the indicator runs at each of the symbol's watched periods.

An instance is `{ id, indicatorKey, version, inputs, label? }`.
`indicatorKey` refers to a definition from `GET /indicators` (#14); `inputs` is validated against that definition's descriptors.

| Method   | Path                                          | Body                                       | Description                                 |
| -------- | --------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `GET`    | `/profiles/{id}/indicators`                   | —                                          | List the profile's attached instances.      |
| `POST`   | `/profiles/{id}/indicators`                   | `{ indicatorKey, inputs?, label? }`        | Attach. **201** / 400 (unknown key / bad inputs) / 404 (unknown profile). |
| `GET`    | `/profiles/{id}/indicators/{instanceId}`      | —                                          | Get one instance. 200 / 404.                |
| `PUT`    | `/profiles/{id}/indicators/{instanceId}`      | `{ indicatorKey, inputs?, label? }`        | Full-replace. 200 / 400 / 404.              |
| `DELETE` | `/profiles/{id}/indicators/{instanceId}`      | —                                          | Detach. **204** / 404.                      |

```sh
# attach the SMA with length 5 and a label
curl -X POST http://localhost:3000/profiles/<id>/indicators \
  -H 'content-type: application/json' \
  -d '{ "indicatorKey": "sma", "inputs": { "length": 5 }, "label": "Fast" }'

# list attached instances
curl http://localhost:3000/profiles/<id>/indicators

# replace the configuration
curl -X PUT http://localhost:3000/profiles/<id>/indicators/<instanceId> \
  -H 'content-type: application/json' \
  -d '{ "indicatorKey": "sma", "inputs": { "length": 21 } }'

# detach
curl -X DELETE http://localhost:3000/profiles/<id>/indicators/<instanceId>
```

## Candles resource

Backfill historical OHLC candles for a **watched** symbol+period into MongoDB and
read them back. A candle is the OHLC base `{ type, time, open, high, low, close }`
plus per-asset-class fields — crypto adds `volume`/`quoteVolume`/`trades`, equities
add `volume`, FX adds none. `time` is the open time in epoch ms.

`from`/`to` are epoch ms; omit both on a backfill to fetch the provider's deepest
available history. The `period` must be one of the symbol's watched periods.

### Endpoints

| Method | Path                              | Body                    | Description                                  |
| ------ | --------------------------------- | ----------------------- | -------------------------------------------- |
| `POST` | `/symbols/{id}/backfill`          | `{ period, from?, to? }` | Start a backfill **job**; returns **202** with the running job. 202 / 400 / 404 / 409. |
| `GET`  | `/symbols/{id}/backfill/jobs/{jobId}` | —                   | Get a backfill job's current state. 200 / 404. |
| `GET`  | `/symbols/{id}/candles?period=&from=&to=&limit=` | —      | Read a page of stored candles (keyset-paginated by time). 200 / 400. |
| `WS`   | `/symbols/{id}/backfill/jobs/{jobId}/progress` | —          | Stream a job's snapshots (see below). |

A backfill runs **asynchronously**: the POST validates and returns 202 with a job
`{ id, symbolId, period, status, progress, summary, error }` (`status` is
`running` | `succeeded` | `failed`; `progress` is `{ saved, total }` once a chunk
lands; `summary` is set on success; `error` on failure). Poll `GET …/jobs/{jobId}`
or stream the WebSocket for updates.

The summary is `{ id, period, from, to, fetched, saved, complete }` (`from`/`to`
are the first/last persisted candle time, or `null` when nothing was fetched;
`complete` is `false` when the provider capped the fetch and more history may
exist). Errors use the uniform `{ "error": "<reason>" }` body — **400** for an
invalid range or a period the symbol does not watch, **404** when the symbol is not
on the watchlist, **409** when a backfill for that symbol+period is already running.
An upstream provider failure does not fail the POST: the job goes `failed` with the
provider's reason in `error`.

`GET …/candles` returns one **keyset-paginated** page: `{ candles, nextCursor }`, where
`candles` is ascending by `time` and `nextCursor` is the `time` to pass as the next
request's `from` (or `null` on the last page). `limit` defaults to 100, max 1000 (over
the max → 400). Page forward by re-issuing with `from = nextCursor`.

### Progress over WebSocket

Connect to `/symbols/{id}/backfill/jobs/{jobId}/progress` with the `jobId` from the
202 response. The socket immediately receives the job's current snapshot, then a
frame on each state change (progress tick and the terminal `succeeded`/`failed`),
each the full job object. Frames are keyed by job id, so concurrent jobs never
interleave; intermediate progress is not replayed.

### Examples

```sh
# start a job; note the returned job id
curl -X POST http://localhost:3000/symbols/crypto:BTCUSDT/backfill \
  -H 'content-type: application/json' -d '{ "period": "1h" }'
# poll the job
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/backfill/jobs/<jobId>'
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/candles?period=1h&limit=500'
# page forward using the returned nextCursor
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/candles?period=1h&from=<nextCursor>&limit=500'
```

## Indicators resource

The **indicator catalog**: every registered indicator module's serialized `IndicatorDefinition` — the input/state schema a UI form renderer or action condition-builder reads.
Metadata only; the `compute` function never leaves the server.

A definition is `{ key, name, description, version, appliesTo, inputs, state }`, where each `inputs`/`state` entry is a typed descriptor (`number` / `source` / `enum`).
The shipped reference modules are **`sma`** (simple moving average) and **`vwma`** (volume-weighted moving average with crossover signal).

### Endpoints

| Method | Path                                         | Body | Description                                                                |
| ------ | -------------------------------------------- | ---- | -------------------------------------------------------------------------- |
| `GET`  | `/indicators`                                | —    | List every registered definition.                                          |
| `GET`  | `/indicators/{key}`                          | —    | Get one definition by key. **200** / 404 with `{ "error": "<reason>" }`.   |
| `GET`  | `/symbols/{id}/indicators/{key}?period=…&…` | —    | Compute the indicator over the symbol's stored candles. **200** / 400 / 404. |

### Compute query

The compute route takes the indicator's scalar inputs as query parameters alongside `period`, optional `from` (epoch ms), and optional `to` (epoch ms):

- `period` is required and must be one of `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`.
- Numeric inputs like `length` come in as query strings; the service coerces them to numbers before validating against the indicator's descriptors.
- The compute service loads candles from the **earliest stored candle** and slices the result to `[from, to)` afterward — so the first row of a requested sub-range is already past warm-up.

Errors map to `{ "error": "<reason>" }`:

- **404** when the symbol isn't on the watchlist or the indicator key is unknown.
- **400** on invalid inputs (out-of-range, wrong type) or an asset-class mismatch (e.g. an FX symbol with a volume-based indicator).

### Examples

```sh
curl http://localhost:3000/indicators
curl http://localhost:3000/indicators/sma
curl http://localhost:3000/indicators/vwma

# compute SMA(3) on a backfilled crypto symbol
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/indicators/sma?period=1h&length=3'

# slice to a sub-range (the first row is already warm)
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/indicators/sma?period=1h&length=3&from=1704153600000'

# VWMA with a deviation threshold and both buy/sell signals
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/indicators/vwma?period=1h&length=14&multiplier=1&direction=both'
```

## Rules resource (`/rules`)

The rule engine's REST surface (per ADR 0016; v1's `/rules` was retired in the cutover — see #397).

A `Rule` couples a `profileId`, a `scope` (`symbol` / `symbols(list)` / `allSymbols`), a `condition` tree (recursive And/Or over `Comparison` / `Crossing` / `Channel` / `Moving` / `State` leaves), one of six `trigger`s (`everyTime`, `once`, `oncePerBar`, `oncePerBarOpen`, `oncePerBarClose`, `oncePerInterval`), an `expiration` (`{ at }` or `null`), and a non-empty `actions[]` (`notification` with `channel: 'telegram'`, or `setSymbolState` / `removeSymbolState` / `setGlobalState` / `removeGlobalState`).

Tick-cadence triggers (`everyTime` / `once` / `oncePerBar`) require every referenced symbol on the watchlist at create/patch time — per ADR 0016 they ride a live quote stream, not the polling loop.
`AllSymbols` scope is exempt (fan-out is dynamic).

### Endpoints

| Method   | Path                                       | Body            | Description                                                                                                |
| -------- | ------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET`    | `/rules?profileId=&symbolId=&enabled=`  | —               | List rules, filtered independently by `profileId`, `symbolId` (scope-aware), and / or `enabled`. 200.      |
| `POST`   | `/rules`                                | `RuleInput`     | Create a rule. **201** / 400 (validation surfaces a `fields[]` array; per-field path + message).           |
| `GET`    | `/rules/{id}`                           | —               | Fetch one rule. 200 / 404.                                                                                 |
| `PATCH`  | `/rules/{id}`                           | `Partial<RuleInput>` | Partial merge over the existing rule; re-runs the tick-eligibility gate on the merged result. 200 / 400 / 404. |
| `DELETE` | `/rules/{id}`                           | —               | Delete a rule. **204** / 404.                                                                              |
| `GET`    | `/rules/{id}/events?limit=&before=&from=&to=`     | —     | Paginated rule events (newest-first); default limit 50, max 500; `before` cursors on `ts` (epoch ms); `from` / `to` apply an inclusive-exclusive window on `ts` (ANDs with `before`). 200 / 404. |
| `GET`    | `/symbols/{id}/rule-events?limit=&before=&from=&to=` | —  | Paginated symbol-mirrored rule events (newest-first); same pagination + windowing. 200.                  |
| `GET`    | `/symbols/{id}/rule-events/count`       | —               | Count of mirrored rule events for the symbol; response `{ "count": <integer> }`. 200.                      |

`RuleInput` is the client-controllable subset of a `Rule` — every field except `id`, `createdAt`, `updatedAt`. Schema validation is the trust boundary (per ADR 0016 #11); the engine trusts the validator. Multi-field failures surface as `{ error, fields: [{ path, message }, ...] }` with one entry per AJV failure (or one per unwatched symbol id for the tick-eligibility error).

### Example

```sh
# Create a "Price > 100" everyTime rule with a setSymbolState action
curl -X POST http://localhost:3000/rules \
  -H 'content-type: application/json' \
  -d '{
    "profileId": "p1",
    "name": "BTC > 100",
    "scope":   { "kind": "symbol", "symbolId": "crypto:BTCUSDT" },
    "condition": {
      "kind": "leaf",
      "leaf": {
        "family":   "comparison",
        "operator": "gt",
        "left":     { "kind": "price" },
        "right":    { "kind": "literal", "value": { "type": "number", "value": 100 } }
      }
    },
    "trigger":    { "kind": "everyTime" },
    "expiration": null,
    "actions":    [{ "kind": "setSymbolState", "key": "fired", "value": { "type": "bool", "value": true } }],
    "enabled":    true,
    "order":      1
  }'
```

## State resource

Read-side views of the rule-engine state — the per-profile global key/value store and (via the symbols resource) per-profile per-symbol state maps. Used by chart markers and debugging; the engine itself writes state through the orchestrator.

State is **partitioned by profile** (#281) — two profiles operating on the same symbol see isolated `state.*` namespaces, so every read takes a `profileId`.

A `StateValue` is a tagged scalar: `{ "type": "string" | "number" | "bool" | "enum", "value": ... }`.

### Endpoints

| Method | Path                                  | Body | Description                                                                              |
| ------ | ------------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `GET`  | `/profiles/{profileId}/state/global`  | —    | Current global state map for `profileId` (`{ [key]: StateValue }`; `{}` when empty). 200. |

The per-symbol state map lives at `GET /symbols/{id}/state?profileId=...` (see the symbols resource).

### Examples

```sh
curl http://localhost:3000/profiles/p1/state/global
```

### State history (chart overlays — issue #434)

Chart-side "States" overlays consume two read-only routes that reconstruct a per-symbol state-key catalog and a per-key time-series from the already-persisted rule-event log (`StateSet` / `StateRemoved` entries on the watchlist document's `events` array).
Both routes are watchlist-scoped (404 on an unknown symbol id).
Neither is partitioned by profile today — `RuleEventEntry` carries no `profileId`, so every key persisted against the symbol is returned regardless of which profile's rule wrote it.

| Method | Path                                                | Body | Description                                                                                                  |
| ------ | --------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/symbols/{id}/state-keys`                          | —    | Alphabetical `[{ key, valueType }]` of every state key the symbol has been written under. **200** / 404.     |
| `GET`  | `/symbols/{id}/state/{key}/series?from=&to=`        | —    | Time-series for one key — one `{ ts, value }` per `StateSet`, one `{ ts, value: null }` per `StateRemoved`, ascending by `ts`. `from` is inclusive, `to` is exclusive (both epoch ms; omit either side for an open bound). **200** / 404. |

```sh
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/state-keys'
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/state/last_signal/series?from=1704000000000&to=1704600000000'
```

## Live stream

Once the service is running it continuously polls each watched symbol+period and
pushes new candles — any subscribed indicator's recomputed state, and any subscribed
symbol's recomputed quote — to clients over one **multiplexed** WebSocket. A single
socket can watch many symbols and hold many indicator/quote subscriptions in parallel.

| Method | Path      | Description                                                                                |
| ------ | --------- | ------------------------------------------------------------------------------------------ |
| `WS`   | `/stream` | Subscribe/unsubscribe to candles, indicators, quotes, and rule events; receive live frames. |

After connecting, send JSON control messages. The route multiplexes four surfaces: candle, indicator, quote, and rule-event.

### Candle subscriptions

Keyed by symbol id.

- `{ "action": "subscribe", "id": "crypto:BTCUSDT" }` — start receiving that symbol.
- `{ "action": "unsubscribe", "id": "crypto:BTCUSDT" }` — stop.

For each polled candle of a subscribed symbol the socket receives a frame:

```json
{ "id": "crypto:BTCUSDT", "period": "1h", "candle": { … }, "final": false }
```

`final` is `true` once the bar has closed and `false` for the still-forming bar
(re-emitted on later polls as it updates). The stream is live-only — it does not
replay history; backfill + `GET …/candles` cover that.

### Indicator subscriptions

Keyed by a server-generated `subscriptionId`, scoped to `(id, period, indicator: { key, inputs })`.

- `{ "action": "subscribe-indicator", "id": "crypto:BTCUSDT", "period": "1h", "indicator": { "key": "sma", "inputs": { "length": 3 } } }` — register interest.
  The server validates (symbol watched, indicator known, asset-class match, inputs valid) and replies with an ack frame:

  ```json
  {
    "action": "subscribed-indicator",
    "subscriptionId": "8X4f…",
    "id": "crypto:BTCUSDT",
    "period": "1h",
    "indicatorKey": "sma"
  }
  ```

  Validation failure replies with `{ "error": "<reason>" }` and no subscription is opened.

- `{ "action": "unsubscribe-indicator", "subscriptionId": "8X4f…" }` — stop frames for that subscription.

For each polled candle on the subscribed `(id, period)`, the indicator is recomputed
and a state frame is delivered to the owning socket:

```json
{
  "subscriptionId": "8X4f…",
  "id": "crypto:BTCUSDT",
  "period": "1h",
  "indicatorKey": "sma",
  "state": { "time": 1704153600000, "value": 42.5 },
  "final": false
}
```

`state` carries only the latest point (one row per frame); `final` mirrors the
underlying candle's `final` (forming bars stream provisional state, closed bars
stream confirmed state).

### Quote subscriptions

Keyed by a server-generated `subscriptionId`, scoped to a symbol id; the quote is
derived on the config's `defaultPeriod` (the live counterpart of `GET /symbols?enrich=true`).

- `{ "action": "subscribe-quote", "id": "crypto:BTCUSDT" }` — register interest.
  The server validates (symbol watched, watches `defaultPeriod`, has ≥ 2 candles there)
  and replies with an ack frame:

  ```json
  { "action": "subscribed-quote", "subscriptionId": "k7Qa…", "id": "crypto:BTCUSDT", "period": "1d" }
  ```

  Validation failure replies with `{ "error": "<reason>" }` and no subscription is opened.

- `{ "action": "unsubscribe-quote", "subscriptionId": "k7Qa…" }` — stop frames for that subscription.

For each polled candle on the subscribed symbol's `defaultPeriod`, a quote frame is
delivered to the owning socket:

```json
{
  "subscriptionId": "k7Qa…",
  "id": "crypto:BTCUSDT",
  "period": "1d",
  "quote": { "price": 110, "change": 10, "changePct": 0.1, "time": 1704153600000 },
  "final": true
}
```

`change`/`changePct` are measured against the previous close; after a `final: true`
frame the baseline rotates to the just-closed bar, so subsequent frames measure
against it (matching the snapshot's "since last close" semantics).

### Rule-event subscriptions

Keyed by symbol id — the mirrored side of the `EventLog`'s append fan-out.

- `{ "action": "subscribe-rule-event", "id": "crypto:BTCUSDT" }` — start receiving each `RuleEventEntry` appended to that symbol's events log.
- `{ "action": "unsubscribe-rule-event", "id": "crypto:BTCUSDT" }` — stop.

For each successful symbol-side append, the socket receives:

```json
{
  "symbolId": "crypto:BTCUSDT",
  "entry": {
    "type": "fired",
    "ts": 1704153600000,
    "firedAt": 1704153600123,
    "ruleId": "rule-1",
    "symbolId": "crypto:BTCUSDT",
    "context": { … }
  }
}
```

`entry` is the same `RuleEventEntry` tagged union the REST event-log endpoints
return (one of `fired` / `notificationSent` / `stateSet` / `stateRemoved` /
`error` / `cycleOverflow`). The stream is live-only — windowed history is on
`GET /symbols/{id}/rule-events?from=&to=`.

Closing the socket releases every subscription on it (candle, indicator, quote, rule-event),
and a malformed control message is answered with an `{ "error": "<reason>" }` frame
instead of being silently dropped.

### Poll cadence

Each period is polled on its own interval (short bars more often than long ones),
with random jitter on top to spread provider load. Defaults (ms): `1m` 5 000, `5m`
30 000, `15m` 60 000, `30m` 120 000, `1h` 300 000, `4h` 900 000, `1d` 1 800 000,
`1w` 3 600 000. Override any subset with `POLL_INTERVALS` as a JSON object, e.g.
`POLL_INTERVALS='{"1m":10000,"5m":60000}'`.
