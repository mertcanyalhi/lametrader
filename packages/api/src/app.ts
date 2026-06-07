import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  ConfigError,
  SymbolConflictError,
  SymbolError,
  SymbolNotFoundError,
} from '@lametrader/core';
import Fastify, { type FastifyError } from 'fastify';
import type { AppDependencies, AppOptions } from './app.types.js';
import { configController } from './controllers/config.controller.js';
import { symbolsController } from './controllers/symbols.controller.js';

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
      info: { title: 'lametrader API', version: '0.0.0' },
      tags: [
        { name: 'config', description: 'Global configuration' },
        { name: 'symbols', description: 'Symbol discovery and watchlist' },
      ],
    },
  });
  app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof SymbolNotFoundError) {
      reply.code(404).send({ error: error.message });
      return;
    }
    if (error instanceof SymbolConflictError) {
      reply.code(409).send({ error: error.message });
      return;
    }
    if (error.validation || error instanceof ConfigError || error instanceof SymbolError) {
      reply.code(400).send({ error: error.message });
      return;
    }
    request.log.error(error);
    reply.code(500).send({ error: 'Unexpected error' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Route ${request.method}:${request.url} not found` });
  });

  app.register(configController(deps.config));
  if (deps.symbols) {
    app.register(symbolsController(deps.symbols));
  }

  return app;
}
