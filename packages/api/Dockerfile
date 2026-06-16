# Multi-stage build for @lametrader/api.
#
# Stage 1 ("build") installs the full workspace, compiles every internal
# dependency the api needs (core, engine) plus the api itself via the root
# project-refs graph, then prunes dev deps so we ship only what runs.
#
# Stage 2 ("run") copies just the pruned node_modules and the compiled
# `dist/` outputs of the three packages the entry point loads.
#
# Build context is the repo root (see infra/docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app

# Lockfile-first copy so `npm ci` layers cache as long as deps don't change.
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages

RUN npm ci
RUN npm run build
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules

# Only the runtime artefacts of the api and the packages it imports.
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
# engine's `nanoid` (^5) does not hoist to the root `node_modules`: the web
# workspace's `vite`/`postcss` pull `nanoid@3`, which npm hoists instead, so
# engine's `nanoid@5` stays nested here. Copy it explicitly — the root
# `node_modules` alone wouldn't satisfy engine's runtime import.
COPY --from=build /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build /app/packages/api/package.json ./packages/api/package.json
COPY --from=build /app/packages/api/dist ./packages/api/dist

EXPOSE 3000
CMD ["node", "packages/api/dist/main.js"]
