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
| `POLL_INTERVALS` | per-period poll cadence (ms) — see [Live candle stream](#live-candle-stream)  |

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
| `GET`    | `/symbols`            | —                       | List the watchlist.                                 |
| `POST`   | `/symbols`            | `{ id, periods? }`      | Add (validates existence). **201** / 400 / 404 / 409. |
| `PATCH`  | `/symbols/{id}`       | `{ periods }`           | Change a symbol's periods. 200 / 400 / 404.         |
| `DELETE` | `/symbols/{id}`       | —                       | Remove a symbol **and its stored candles**. **204**. |

Errors use the uniform `{ "error": "<reason>" }` body — **400** for invalid input,
**404** when the symbol doesn't exist at its source or isn't watched, **409** when
re-adding an already-watched symbol (re-adding never changes its periods; use
`PATCH`).

### Examples

```sh
curl 'http://localhost:3000/instruments?q=bitcoin&type=crypto'
curl -X POST http://localhost:3000/symbols \
  -H 'content-type: application/json' -d '{ "id": "crypto:BTCUSDT" }'
curl http://localhost:3000/symbols
curl -X PATCH http://localhost:3000/symbols/crypto:BTCUSDT \
  -H 'content-type: application/json' -d '{ "periods": ["1h"] }'
curl -X DELETE http://localhost:3000/symbols/crypto:BTCUSDT
```

## Profiles resource

A **profile** is a named, enable/disable-able template scoped to watched symbols —
either all of them (the default) or an explicit subset. It will later hold
indicators and actions. A profile is
`{ id, name, description, enabled, scope, createdAt, updatedAt }`, where `scope` is
either `{ "type": "all" }` or `{ "type": "symbols", "symbolIds": [...] }`. Names are
unique; every id in a `symbols` scope must be currently watched, and an empty subset
normalizes to `all`.

### Endpoints

| Method   | Path             | Body                                       | Description                          |
| -------- | ---------------- | ------------------------------------------ | ------------------------------------ |
| `GET`    | `/profiles`      | —                                          | List profiles.                       |
| `POST`   | `/profiles`      | `{ name, description?, enabled?, scope? }` | Create. **201** / 400 / 409.         |
| `GET`    | `/profiles/{id}` | —                                          | Get one. 200 / 404.                  |
| `PUT`    | `/profiles/{id}` | `{ name, description?, enabled?, scope? }` | Full replace. 200 / 400 / 404 / 409. |
| `PATCH`  | `/profiles/{id}` | `{ name?, description?, enabled?, scope? }` | Partial update. 200 / 400 / 404 / 409. |
| `DELETE` | `/profiles/{id}` | —                                          | Delete. **204** / 404.               |

Errors use the uniform `{ "error": "<reason>" }` body — **400** for invalid input
or a scope referencing an unwatched symbol, **404** for an unknown profile, **409**
for a duplicate name. Removing a watched symbol prunes it from every profile's
subset; a profile left with an empty subset is **disabled** (kept symbols-scoped)
rather than widened to `all`.

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

## Candles resource

Backfill historical OHLC candles for a **watched** symbol+period into MongoDB and
read them back. A candle is the OHLC base `{ type, time, open, high, low, close }`
plus per-asset-class fields — crypto adds `volume`/`quoteVolume`/`trades`, equities
add `volume`/`adjClose`, FX adds none. `time` is the open time in epoch ms.

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

## Live candle stream

Once the service is running it continuously polls each watched symbol+period and
pushes new candles to clients over one **multiplexed** WebSocket — a single socket
can watch many symbols.

| Method | Path      | Description                                            |
| ------ | --------- | ----------------------------------------------------- |
| `WS`   | `/stream` | Subscribe/unsubscribe to symbols; receive candle frames. |

After connecting, send control messages:

- `{ "action": "subscribe", "id": "crypto:BTCUSDT" }` — start receiving that symbol.
- `{ "action": "unsubscribe", "id": "crypto:BTCUSDT" }` — stop.

For each polled candle of a subscribed symbol the socket receives a frame:

```json
{ "id": "crypto:BTCUSDT", "period": "1h", "candle": { … }, "final": false }
```

`final` is `true` once the bar has closed and `false` for the still-forming bar
(re-emitted on later polls as it updates). The stream is live-only — it does not
replay history; backfill + `GET …/candles` cover that.

### Poll cadence

Each period is polled on its own interval (short bars more often than long ones),
with random jitter on top to spread provider load. Defaults (ms): `1m` 5 000, `5m`
30 000, `15m` 60 000, `30m` 120 000, `1h` 300 000, `4h` 900 000, `1d` 1 800 000,
`1w` 3 600 000. Override any subset with `POLL_INTERVALS` as a JSON object, e.g.
`POLL_INTERVALS='{"1m":10000,"5m":60000}'`.
