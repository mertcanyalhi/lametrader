import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ConfigError } from '@lametrader/core';
import type { ConfigService } from '@lametrader/engine';
import Fastify, { type FastifyError } from 'fastify';
import type { AppOptions } from './app.types.js';
import { configController } from './controllers/config.controller.js';

/**
 * Build the REST API over a {@link ConfigService}.
 *
 * Wires OpenAPI docs (`/docs`), the typed config controller, and a single error
 * handler + not-found handler that produce a uniform `{ error }` body: schema
 * and domain ({@link ConfigError}) failures map to 400, unknown routes to 404,
 * anything else to 500.
 *
 * @param service - the configuration use-case to drive.
 * @param options - app options (see {@link AppOptions}).
 */
export function createApp(service: ConfigService, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false }).withTypeProvider<TypeBoxTypeProvider>();

  app.register(fastifySwagger, {
    openapi: {
      info: { title: 'lametrader API', version: '0.0.0' },
      tags: [{ name: 'config', description: 'Global configuration' }],
    },
  });
  app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation || error instanceof ConfigError) {
      reply.code(400).send({ error: error.message });
      return;
    }
    request.log.error(error);
    reply.code(500).send({ error: 'Unexpected error' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Route ${request.method}:${request.url} not found` });
  });

  app.register(configController(service));

  return app;
}
