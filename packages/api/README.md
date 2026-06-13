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

| Variable      | Default                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `MONGODB_URI` | `mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin` |
| `PORT`        | `3000`                                                                        |

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
| `POST` | `/symbols/{id}/backfill`          | `{ period, from?, to? }` | Backfill candles; returns the summary. 200 / 400 / 404. |
| `GET`  | `/symbols/{id}/candles?period=&from=&to=&limit=` | —      | Read a page of stored candles (keyset-paginated by time). 200 / 400. |
| `WS`   | `/symbols/{id}/backfill/progress` | —                       | Stream backfill progress frames (see below). |

The backfill summary is `{ id, period, from, to, fetched, saved, complete }`
(`from`/`to` are the first/last persisted candle time, or `null` when nothing was
fetched; `complete` is `false` when the provider capped the fetch and more history
may exist). Errors
use the uniform `{ "error": "<reason>" }` body — **400** for an invalid range or a
period the symbol does not watch, **404** when the symbol is not on the watchlist,
**502** when the upstream market-data provider fails (the body carries the provider's
reason).

`GET …/candles` returns one **keyset-paginated** page: `{ candles, nextCursor }`, where
`candles` is ascending by `time` and `nextCursor` is the `time` to pass as the next
request's `from` (or `null` on the last page). `limit` defaults to 100, max 1000 (over
the max → 400). Page forward by re-issuing with `from = nextCursor`.

### Progress over WebSocket

Subscribe to `/symbols/{id}/backfill/progress` *before* triggering a backfill; while
one runs, the socket receives JSON frames:

- `{ "type": "progress", "saved": <n>, "total": <n> }` — after each persisted chunk.
- `{ "type": "summary", "summary": { … } }` — once, when the backfill completes.

### Examples

```sh
curl -X POST http://localhost:3000/symbols/crypto:BTCUSDT/backfill \
  -H 'content-type: application/json' -d '{ "period": "1h" }'
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/candles?period=1h&limit=500'
# page forward using the returned nextCursor
curl 'http://localhost:3000/symbols/crypto:BTCUSDT/candles?period=1h&from=<nextCursor>&limit=500'
```
