# infra

Local development infrastructure, run via Docker Compose.

## Services

| Service         | Image                                | Profile   | Port    | Notes                                                                       |
| --------------- | ------------------------------------ | --------- | ------- | --------------------------------------------------------------------------- |
| `mongo`         | `mongo:8`                            | (default) | `27017` | Primary datastore. Data persists in the `lametrader-mongo-data` volume.     |
| `mongo-express` | `mongo-express:1.0.2`                | `tools`   | `8081`  | Web admin UI.                                                               |
| `api`           | built from `packages/api/Dockerfile` | `app`     | `3000`  | Fastify API. Wired to the `mongo` service over the compose network.         |
| `web`           | built from `packages/web/Dockerfile` | `app`     | `8080`  | Vite build served by nginx, with `/api/*` reverse-proxied to `api:3000`.    |

Host bindings use each service's standard port. If one is already taken
by another local stack, override it in `infra/.env` (`MONGO_PORT`,
`MONGO_EXPRESS_PORT`, `API_PORT`, `WEB_PORT`); the container-internal
ports stay standard so services keep finding each other on the compose
network.

## Usage

Two modes from the repo root:

```bash
# --- infra only (the TDD loop) -----------------------------------------------
npm run infra:up        # MongoDB only, detached. Use with `npm run api:dev` etc.
npm run infra:logs
npm run infra:down      # stop (keeps data)
npm run infra:reset     # stop AND delete the data volume

# --- full stack (api + web + mongo) ------------------------------------------
npm run app:up          # build images if needed + start everything
npm run app:logs
npm run app:down        # stop the stack
npm run app:build       # rebuild images without starting
```

After `npm run app:up`:

- Web UI: <http://localhost:8080>
- API (direct): <http://localhost:3000> — Swagger UI at `/docs`
- API (via the web's reverse proxy): <http://localhost:8080/api/> — same routes, stripped of the prefix (`/api/config` → api's `/config`)

The reverse proxy lets the browser stay same-origin, so the SPA can fetch
relative URLs (`fetch('/api/config')`) without any CORS configuration.

Start the optional Mongo admin UI alongside either mode:

```bash
docker compose -f infra/docker-compose.yml --profile tools up -d
# → http://localhost:8081
```

## Connecting

The root user authenticates against the `admin` database, so include `authSource=admin`:

```
mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin
```

This matches the engine's `loadSettings` default, so `npm run api:dev`
finds the dockerized mongo with no extra env. The dockerized api reaches
mongo on the compose network as `mongo:27017` and likewise needs no
override.

## Configuration

Everything has defaults, so the stack runs with no setup. To override credentials
or ports, copy [.env.example](.env.example) to `infra/.env` (git-ignored) and edit.
