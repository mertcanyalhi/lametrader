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
