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
| `DELETE` | `/symbols/{id}`       | —                       | Remove a symbol. **204**.                           |

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
