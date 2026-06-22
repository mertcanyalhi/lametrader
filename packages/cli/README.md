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
- **`list [--enrich]`** — print the watchlist as JSON. With `--enrich`, each item
  carries a `quote` (`{ price, change, changePct, period, time }`) computed from the
  symbol's stored candles on the config's `defaultPeriod`, or `null` when none can be
  computed (the symbol doesn't watch `defaultPeriod`, or has fewer than two candles there).
- **`remove <id>`** — remove a symbol (also deletes its stored candles).
- **`set-periods <id> --periods <csv>`** — change a watched symbol's periods.

#### Examples

```sh
npm run cli -- symbols discover bitcoin --type crypto
npm run cli -- symbols add crypto:BTCUSDT
npm run cli -- symbols add stock:AAPL --periods 1h,1d
npm run cli -- symbols list
npm run cli -- symbols list --enrich
npm run cli -- symbols set-periods crypto:BTCUSDT --periods 1h
npm run cli -- symbols remove crypto:BTCUSDT
```

### `profile`

Manage profiles — named, enable/disable-able templates scoped to watched symbols.
A profile applies to **all** watched symbols by default, or to an explicit subset (`--symbols`).
Every id in a subset must be currently watched, and an empty subset normalizes to "all".
Names are unique.

#### Subcommands

- **`list`** — print all profiles as JSON.
- **`create --name <n> [--description <d>] [--disabled] [--symbols <csv>]`** — create a profile.
  `--symbols` scopes it to that subset (otherwise all); `--disabled` creates it disabled.
- **`update <id> [--name <n>] [--description <d>] [--enable|--disable] [--all|--symbols <csv>]`** — patch the given fields.
  `--all` resets the scope to all watched symbols.
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

#### Attached indicators (sub-group)

Manage indicator instances attached to a profile.
Each instance carries the indicator's key + validated inputs (a label is optional); the instance has no period — at compute time the indicator runs at every period the symbol is watched at.

- **`profile indicators list <profileId>`** — print the embedded instances as JSON.
- **`profile indicators add <profileId> --indicator-key <k> [--label <s>] [--inputs '<json>']`** — attach.
- **`profile indicators update <profileId> <instanceId> --indicator-key <k> [--label <s>] [--inputs '<json>']`** — full-replace.
- **`profile indicators remove <profileId> <instanceId>`** — detach.

```sh
npm run cli -- profile indicators add <profileId> --indicator-key sma --inputs '{"length":5}' --label Fast
npm run cli -- profile indicators list <profileId>
npm run cli -- profile indicators update <profileId> <instanceId> --indicator-key sma --inputs '{"length":21}'
npm run cli -- profile indicators remove <profileId> <instanceId>
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

### `indicators`

Read the **indicator catalog** and (with a connected Mongo) compute an indicator over a watched symbol's stored candles.

#### Subcommands

- **`list`** — print every registered definition as JSON.
- **`show <key>`** — print the matching definition; an unknown key errors with `IndicatorNotFoundError`.
- **`compute <symbolId> <key> --period <p> [--from <ms>] [--to <ms>] [--inputs '<json>']`** — compute the indicator over the symbol's stored candles and print the aligned series.
  `--inputs` is a JSON literal; omitted inputs fall back to the indicator's defaults.

#### Examples

```sh
npm run cli -- indicators list
npm run cli -- indicators show sma
npm run cli -- indicators show vwma

# compute SMA(3) on a backfilled crypto symbol
npm run cli -- indicators compute crypto:BTCUSDT sma --period 1h --inputs '{"length":3}'

# slice to a sub-range
npm run cli -- indicators compute crypto:BTCUSDT sma --period 1h --inputs '{"length":3}' --from 1704153600000

# VWMA with deviation threshold and both buy/sell signals
npm run cli -- indicators compute crypto:BTCUSDT vwma --period 1h --inputs '{"length":14,"multiplier":1,"direction":"both"}'
```

### `rules`

Read rules persisted by the engine (CRUD lands in a follow-up sub-issue).

#### Subcommands

- **`list [--profile <id>] [--symbol <id>] [--enabled]`** — print rules as JSON, sorted ascending by `order`. `--profile` narrows to one profile; `--symbol` returns rules whose scope is that symbol (plus any `AllSymbols` rule); `--enabled` drops disabled rules.
- **`show <id>`** — print one rule by id; an unknown id errors with `RuleNotFoundError`.
- **`create --profile <id> --file <path>`** — read a JSON `RuleCreateInput` from the file, set the profileId from `--profile` (overrides the file's value), validate via `validateRule`, persist, and print the created rule.
- **`update <id> --file <path>`** — read a JSON `RuleCreateInput` from the file and replace the rule's mutable fields (preserves `id`, `events`, `history`, `createdAt`; bumps `updatedAt`; appends an `Updated` history entry).
- **`delete <id>`** — remove the rule (cascades its persisted firing-state). Prints `deleted <id>` on success.
- **`enable <id>`** / **`disable <id>`** — flip the rule's `enabled` flag and append an `Enabled` / `Disabled` history entry; echoes the updated rule.
- **`reorder --order <csv>`** — bulk-renumber rule `order` to the 1-based positions of the comma-separated ids (e.g. `--order r2,r3,r1`); echoes the renumbered rules.
- **`events <id> [--limit N]`** / **`events --symbol <id> [--limit N]`** — paginated rule-firing events newest-first (default 20, max 500), by rule id (positional) or by symbol (`--symbol`).

#### Examples

```sh
npm run cli -- rules list
npm run cli -- rules list --profile p1
npm run cli -- rules list --profile p1 --symbol crypto:BTCUSDT --enabled
npm run cli -- rules show <id>
npm run cli -- rules create --profile p1 --file rule.json
npm run cli -- rules update <id> --file rule.json
npm run cli -- rules delete <id>
npm run cli -- rules enable <id>
npm run cli -- rules disable <id>
npm run cli -- rules reorder --order r2,r3,r1
npm run cli -- rules events <id>
npm run cli -- rules events --symbol crypto:BTCUSDT --limit 50
```

### `state`

Read and (for debugging) write the rule-engine state. Writes go straight at the `StateRepository` port — production state should be set by the orchestrator's action executors, not by hand.

#### Subcommands

- **`list --symbol <id>`** — print the symbol's current state map (`{ [key]: StateValue }`) as JSON. Unknown symbol errors with `SymbolNotFoundError`.
- **`list --global`** — print the global state map as JSON.
- **`set --symbol <id>|--global --key <k> --value <v> --type <string|number|bool|enum>`** — write the value (the `--type` flag validates `--value`: numbers must be finite, `bool` must be `true`/`false`). On success, prints the new state map.
- **`remove --symbol <id>|--global --key <k>`** — drop the key; prints the new state map (a no-op when the key was already absent).

Exactly one of `--symbol` / `--global` must be provided for every subcommand.

#### Examples

```sh
npm run cli -- state list --symbol crypto:BTCUSDT
npm run cli -- state list --global
npm run cli -- state set --symbol crypto:BTCUSDT --key armed --value true --type bool
npm run cli -- state set --global --key regime --value risk-on --type enum
npm run cli -- state remove --symbol crypto:BTCUSDT --key armed
npm run cli -- state remove --global --key regime
```
