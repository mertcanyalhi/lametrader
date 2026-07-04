# Multi-stage build for @lametrader/web.
#
# Stage 1 installs the workspace, builds `@lametrader/core`, then runs
# `vite build`. The core build must come first: Vite and the web's
# `tsc --noEmit` resolve `@lametrader/core` to its built `dist/` (the web
# package is bundler-owned, not part of the root project-refs graph), so the
# dependency has to exist before the web build runs.
# Stage 2 serves the static `dist/` through nginx on port 8080, with a
# reverse-proxy hop for `/api/*` to the NestJS server so the browser stays
# same-origin (no CORS).
#
# Build context is the repo root (see infra/docker-compose.yml).

FROM node:26-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages

RUN npm ci
RUN npm run build -w @lametrader/core
RUN npm run build -w @lametrader/web

FROM nginx:1.31.2-alpine AS run
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 8080
