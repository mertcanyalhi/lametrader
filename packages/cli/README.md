# @lametrader/cli

Command-line driving adapter. Installs the `lametrader` binary.

## Running

```sh
npm run infra:up               # start MongoDB
npm run build                  # compile the workspace
npm run cli -- <command>       # e.g. npm run cli -- config get
```

### Settings

Resolved from the environment (with defaults) via the engine settings layer:

| Variable      | Default                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `MONGODB_URI` | `mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin` |

## Commands

### `config`

Manage the global configuration.

#### Fields

- **`periods`** — the supported periods. Each value must be one of:
  `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`.
- **`defaultPeriod`** — the period shown by default. Must be one of `periods`.

Defaults, when nothing has been stored yet:

- `periods`: `1h`, `1d`
- `defaultPeriod`: `1d`

#### Subcommands

- **`get`** — print the current config as JSON.
- **`set --periods <csv> --default-period <value>`** — validate and persist a new config.

#### Examples

Show the current config:

```sh
npm run cli -- config get
```

Set the supported periods and the default:

```sh
npm run cli -- config set --periods 1h,1d --default-period 1d
```

### `symbols`

Discover, add/remove, and tune watchlist symbols. Canonical ids are
`<type>:<ticker>` (`crypto`, `stock`, `fund`, `fx`), e.g. `crypto:BTCUSDT`,
`stock:AAPL`, `fx:EURUSD`. Crypto is served by Binance; stocks/funds/FX by Yahoo.

#### Subcommands

- **`discover <query> [--type <type>]`** — search sources for matching instruments (JSON).
- **`add <id> [--periods <csv>]`** — validate the id exists, then add it. Periods
  default to the config's `periods` and must be a subset of them.
- **`list`** — print the watchlist as JSON.
- **`remove <id>`** — remove a symbol (also deletes its stored candles).
- **`set-periods <id> --periods <csv>`** — change a watched symbol's periods.

#### Examples

```sh
npm run cli -- symbols discover bitcoin --type crypto
npm run cli -- symbols add crypto:BTCUSDT
npm run cli -- symbols add stock:AAPL --periods 1h,1d
npm run cli -- symbols list
npm run cli -- symbols set-periods crypto:BTCUSDT --periods 1h
npm run cli -- symbols remove crypto:BTCUSDT
```

### `profile`

Manage profiles — named, enable/disable-able templates scoped to watched symbols.
A profile applies to **all** watched symbols by default, or to an explicit subset
(`--symbols`); every id in a subset must be currently watched, and an empty subset
normalizes to "all". Names are unique.

#### Subcommands

- **`list`** — print all profiles as JSON.
- **`create --name <n> [--description <d>] [--disabled] [--symbols <csv>]`** —
  create a profile. `--symbols` scopes it to that subset (otherwise all);
  `--disabled` creates it disabled.
- **`update <id> [--name <n>] [--description <d>] [--enable|--disable] [--all|--symbols <csv>]`**
  — patch the given fields (`--all` resets the scope to all watched symbols).
- **`delete <id>`** — remove a profile.

#### Examples

```sh
npm run cli -- profile create --name Scalper
npm run cli -- profile create --name BtcOnly --symbols crypto:BTCUSDT
npm run cli -- profile list
npm run cli -- profile update <id> --disable
npm run cli -- profile update <id> --symbols crypto:BTCUSDT,crypto:ETHUSDT
npm run cli -- profile delete <id>
```

### `candles`

Backfill historical OHLC candles for a **watched** symbol+period into MongoDB and
read them back. The `--period` must be one of the symbol's watched periods.
`--from`/`--to` are epoch milliseconds; omit both to backfill the provider's
deepest available history.

#### Subcommands

- **`backfill <id> --period <p> [--from <ms> --to <ms>]`** — fetch and persist
  candles, streaming `progress: <saved>/<total>` lines, then echo the summary JSON
  (`{ id, period, from, to, fetched, saved, complete }`; `complete` is `false` when
  the provider capped the fetch and more history may exist).
- **`list <id> --period <p> [--from <ms> --to <ms>] [--limit N]`** — print one page
  of stored candles as JSON: `{ candles, nextCursor }`. Candles are keyset-paginated
  by `time`; pass the returned `nextCursor` as the next `--from` to page forward.
  `--limit` defaults to 100 (max 1000).

#### Examples

```sh
npm run cli -- candles backfill crypto:BTCUSDT --period 1h
npm run cli -- candles backfill stock:AAPL --period 1d --from 1704067200000 --to 1706745600000
npm run cli -- candles list crypto:BTCUSDT --period 1h --limit 500
# page forward: feed the previous nextCursor back in as --from
npm run cli -- candles list crypto:BTCUSDT --period 1h --from 1704153600000 --limit 500
```
