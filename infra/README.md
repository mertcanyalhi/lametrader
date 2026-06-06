# infra

Local development infrastructure, run via Docker Compose.

## Services

| Service | Image | Port | Notes |
| --- | --- | --- | --- |
| `mongo` | `mongo:8` | `27017` | Primary datastore. Data persists in the `lametrader-mongo-data` volume. |
| `mongo-express` | `mongo-express:1.0.2` | `8081` | Web admin UI. Opt-in via the `tools` profile. |

## Usage

From the repo root:

```bash
npm run infra:up        # start MongoDB (detached)
npm run infra:logs      # tail logs
npm run infra:down      # stop containers (keeps data)
npm run infra:reset     # stop AND delete the data volume
```

Start the optional admin UI too:

```bash
docker compose -f infra/docker-compose.yml --profile tools up -d
# → http://localhost:8081
```

## Connecting

The root user authenticates against the `admin` database, so include `authSource=admin`:

```
mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin
```

## Configuration

Everything has defaults, so the stack runs with no setup. To override credentials
or ports, copy [.env.example](.env.example) to `infra/.env` (git-ignored) and edit.
