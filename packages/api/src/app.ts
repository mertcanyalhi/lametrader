import { createRequire } from 'node:module';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import fastifyWebsocket from '@fastify/websocket';
import {
  BackfillConflictError,
  CandleError,
  ConfigError,
  IndicatorError,
  IndicatorInstanceNotFoundError,
  IndicatorNotFoundError,
  MarketDataError,
  ProfileConflictError,
  ProfileError,
  ProfileNotFoundError,
  RuleError,
  RuleNotFoundError,
  SymbolConflictError,
  SymbolError,
  SymbolNotFoundError,
  TelegramDestinationError,
  TelegramDestinationNotFoundError,
  TickRuleNotEligibleError,
} from '@lametrader/core';
import { type BackfillJob, BackfillJobService } from '@lametrader/engine';
import Fastify, { type FastifyError } from 'fastify';
import type { AppDependencies, AppOptions } from './app.types.js';
import { candlesController } from './controllers/candles.controller.js';
import { configController } from './controllers/config.controller.js';
import { indicatorsController } from './controllers/indicators.controller.js';
import { notificationsController } from './controllers/notifications.controller.js';
import { profilesController } from './controllers/profiles.controller.js';
import { rulesV2Controller } from './controllers/rules-v2.controller.js';
import { stateController } from './controllers/state.controller.js';
import { streamController } from './controllers/stream.controller.js';
import { symbolsController } from './controllers/symbols.controller.js';
import { StreamHub } from './stream-hub.js';

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
        { name: 'profiles', description: 'Profiles (selectable templates)' },
        { name: 'rules-v2', description: 'Rule definitions and events (per ADR 0016)' },
        { name: 'candles', description: 'Historical candle backfill and reads' },
        { name: 'indicators', description: 'Indicator catalog (descriptors only)' },
      ],
    },
  });
  app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  app.register(fastifyWebsocket);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (
      error instanceof SymbolNotFoundError ||
      error instanceof ProfileNotFoundError ||
      error instanceof RuleNotFoundError ||
      error instanceof IndicatorNotFoundError ||
      error instanceof IndicatorInstanceNotFoundError ||
      error instanceof TelegramDestinationNotFoundError
    ) {
      reply.code(404).send({ error: error.message });
      return;
    }
    if (
      error instanceof SymbolConflictError ||
      error instanceof BackfillConflictError ||
      error instanceof ProfileConflictError
    ) {
      reply.code(409).send({ error: error.message });
      return;
    }
    if (error.validation) {
      // AJV validation failure — surface the full set of failing paths via
      // an additive `fields[]` array (per ADR 0016 / rules-v2 spec).
      // v1 consumers ignore `fields` and continue reading `error`.
      reply.code(400).send({
        error: error.message,
        fields: error.validation.map((failure) => ({
          path: ajvPathToDotted(failure.instancePath),
          message: failure.message ?? 'invalid',
        })),
      });
      return;
    }
    if (error instanceof TickRuleNotEligibleError) {
      reply.code(400).send({
        error: error.message,
        fields: error.unwatchedSymbolIds.map((symbolId) => ({
          path: 'scope.symbolId',
          message: `symbol not on watchlist: ${symbolId}`,
        })),
      });
      return;
    }
    if (
      error instanceof ConfigError ||
      error instanceof SymbolError ||
      error instanceof CandleError ||
      error instanceof ProfileError ||
      error instanceof RuleError ||
      error instanceof IndicatorError ||
      error instanceof TelegramDestinationError
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

  /**
   * Convert an AJV `instancePath` (`/scope/symbolId`) to the dotted body path
   * the v2 controller surfaces (`scope.symbolId`).
   * AJV uses an empty string for the body root; map it to a literal `''` so
   * callers can still distinguish root-level errors.
   */
  function ajvPathToDotted(instancePath: string): string {
    if (instancePath === '') return '';
    return instancePath.replace(/^\//, '').replace(/\//g, '.');
  }

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Route ${request.method}:${request.url} not found` });
  });

  app.register(configController(deps.config));
  if (deps.symbols) {
    app.register(symbolsController(deps.symbols));
  }
  if (deps.profiles) {
    app.register(profilesController(deps.profiles));
  }
  if (deps.rulesV2) {
    // v2 surface is mounted under /v2; v1 routes have been removed.
    app.register(rulesV2Controller(deps.rulesV2), { prefix: '/v2' });
  }
  if (deps.state) {
    app.register(stateController(deps.state));
  }
  if (deps.telegramDestinations) {
    app.register(notificationsController(deps.telegramDestinations));
  }
  app.register(indicatorsController(deps.indicators.registry, deps.indicators.compute));
  if (deps.backfill) {
    // Wire the async backfill-job use-case to a per-job hub: the application
    // pushes job updates via onUpdate, the hub fans them to WebSocket subscribers.
    const backfillHub = new StreamHub<BackfillJob>();
    const backfillJobs = new BackfillJobService(deps.backfill, (job) =>
      backfillHub.publish(job.id, job),
    );
    app.register(candlesController(deps.backfill, backfillJobs, backfillHub));
  }
  if (deps.liveStream) {
    app.register(streamController(deps.liveStream));
  }

  return app;
}
