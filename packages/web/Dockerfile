# Multi-stage build for @lametrader/web.
#
# Stage 1 installs the workspace and runs `vite build` for the web package.
# Stage 2 serves the static `dist/` through nginx on port 8080, with a
# reverse-proxy hop for `/api/*` so the browser stays same-origin (no CORS).
#
# Build context is the repo root (see infra/docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages

RUN npm ci
RUN npm run build -w @lametrader/web

FROM nginx:1.27-alpine AS run
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 8080
