# Multi-stage build for @lametrader/server (the NestJS backend).
#
# Stage 1 ("build") installs the full workspace, builds @lametrader/core (the
# server's only internal dependency — shared types + enums + pure helpers) and
# then the server itself, then prunes dev deps so we ship only what runs. The
# server is built on its own (`tsc`, decorator metadata emitted per its tsconfig)
# rather than through the root project-refs graph — exactly like web is owned by
# Vite — so core is built first, then the server against core's `dist/`.
#
# Stage 2 ("run") copies just the pruned node_modules and the compiled `dist/`
# outputs of the two packages the entry point loads (server + core).
#
# Build context is the repo root (see infra/docker-compose.yml).

FROM node:26-alpine AS build
WORKDIR /app

# Lockfile-first copy so `npm ci` layers cache as long as deps don't change.
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages

RUN npm ci
RUN npm run build -w @lametrader/core
RUN npm run build -w @lametrader/server
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:26-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules

# Only the runtime artefacts of the server and the core package it imports.
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist

EXPOSE 3000
CMD ["node", "packages/server/dist/main.js"]
