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
