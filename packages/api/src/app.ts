import { createRequire } from 'node:module';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import fastifyWebsocket from '@fastify/websocket';
import {
  CandleError,
  ConfigError,
  MarketDataError,
  SymbolConflictError,
  SymbolError,
  SymbolNotFoundError,
} from '@lametrader/core';
import Fastify, { type FastifyError } from 'fastify';
import type { AppDependencies, AppOptions } from './app.types.js';
import { BackfillProgressHub } from './backfill-progress-hub.js';
import { candlesController } from './controllers/candles.controller.js';
import { configController } from './controllers/config.controller.js';
import { symbolsController } from './controllers/symbols.controller.js';

/**
 * The API's own package version, read from its `package.json` so the OpenAPI
 * document reports the real release rather than a hard-coded literal that drifts.
 */
const { version: API_VERSION } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

/**
 * Build the REST API over the application use-cases.
 *
 * Wires OpenAPI docs (`/docs`), the config + symbols controllers, and one error
 * handler + not-found handler that produce a uniform `{ error }` body: schema and
 * client-input failures ({@link ConfigError}, {@link SymbolError}) map to 400,
 * {@link SymbolNotFoundError} to 404, unknown routes to 404, anything else to 500.
 *
 * @param deps - the use-cases to drive (see {@link AppDependencies}).
 * @param options - app options (see {@link AppOptions}).
 */
export function createApp(deps: AppDependencies, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false }).withTypeProvider<TypeBoxTypeProvider>();

  app.register(fastifySwagger, {
    openapi: {
      info: { title: 'lametrader API', version: API_VERSION },
      tags: [
        { name: 'config', description: 'Global configuration' },
        { name: 'symbols', description: 'Symbol discovery and watchlist' },
        { name: 'candles', description: 'Historical candle backfill and reads' },
      ],
    },
  });
  app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  app.register(fastifyWebsocket);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof SymbolNotFoundError) {
      reply.code(404).send({ error: error.message });
      return;
    }
    if (error instanceof SymbolConflictError) {
      reply.code(409).send({ error: error.message });
      return;
    }
    if (
      error.validation ||
      error instanceof ConfigError ||
      error instanceof SymbolError ||
      error instanceof CandleError
    ) {
      reply.code(400).send({ error: error.message });
      return;
    }
    if (error instanceof MarketDataError) {
      // Upstream market-data provider failed — surface it as a bad gateway, not a
      // generic 500, and keep the reason (logged with the provider cause).
      request.log.warn({ err: error }, 'market-data source failed');
      reply.code(502).send({ error: error.message });
      return;
    }
    request.log.error(error);
    reply.code(500).send({ error: 'Unexpected error' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Route ${request.method}:${request.url} not found` });
  });

  app.register(configController(deps.config));
  app.register(symbolsController(deps.symbols));
  app.register(candlesController(deps.backfill, new BackfillProgressHub()));

  return app;
}
