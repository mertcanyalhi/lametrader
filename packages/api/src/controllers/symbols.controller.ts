import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { SymbolNotFoundError } from '@lametrader/core';
import type { StateHistoryService, SymbolService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';
import { StateValueSchema } from '../schemas/state.schema.js';
import {
  AddSymbolSchema,
  DiscoverQuerySchema,
  EnrichedSymbolSchema,
  InstrumentSchema,
  ListSymbolsQuerySchema,
  PatchSymbolSchema,
  StateHistoryEntrySchema,
  StateHistorySeriesParamsSchema,
  StateHistorySeriesQuerySchema,
  StateKeyDescriptorSchema,
  SymbolIdParamSchema,
  WatchedSymbolSchema,
} from '../schemas/symbol.schema.js';

/**
 * Required `?profileId=...` query for `GET /symbols/:id/state` — state is
 * partitioned by profile (#281), so the caller has to name one.
 */
const SymbolStateQuerySchema = Type.Object(
  {
    profileId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/**
 * Register the RESTful symbol routes against a {@link SymbolService} and the
 * (optional) {@link StateHistoryService}.
 *
 * Schemas (TypeBox) validate input at the boundary and type the handlers;
 * domain failures (`SymbolError` → 400, `SymbolNotFoundError` → 404) are mapped by
 * the app's error handler. Response schemas pin the output and feed OpenAPI.
 *
 * When `stateHistory` is omitted, the state-overlay routes (#434) are not
 * registered — the rest of the symbol surface stays available.
 *
 * @param service - the symbols use-case to drive.
 * @param stateHistory - the state-history use-case (chart state overlays).
 */
export function symbolsController(service: SymbolService, stateHistory?: StateHistoryService) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/instruments',
      {
        schema: {
          tags: ['symbols'],
          summary: 'Discover symbols',
          querystring: DiscoverQuerySchema,
          response: { 200: Type.Array(InstrumentSchema) },
        },
      },
      async (request) => service.discover(request.query.q, request.query.type),
    );

    app.get(
      '/symbols',
      {
        schema: {
          tags: ['symbols'],
          summary: 'List watched symbols',
          description: 'With ?enrich=true, each item carries a computed quote.',
          querystring: ListSymbolsQuerySchema,
          response: { 200: Type.Array(Type.Union([WatchedSymbolSchema, EnrichedSymbolSchema])) },
        },
      },
      async (request) => (request.query.enrich ? service.listWithQuotes() : service.list()),
    );

    app.post(
      '/symbols',
      {
        schema: {
          tags: ['symbols'],
          summary: 'Add a symbol to the watchlist',
          body: AddSymbolSchema,
          response: {
            201: WatchedSymbolSchema,
            400: ErrorSchema,
            404: ErrorSchema,
            409: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const watched = await service.add(request.body.id, request.body.periods);
        reply.code(201);
        return watched;
      },
    );

    app.patch(
      '/symbols/:id',
      {
        schema: {
          tags: ['symbols'],
          summary: "Change a symbol's periods",
          params: SymbolIdParamSchema,
          body: PatchSymbolSchema,
          response: { 200: WatchedSymbolSchema, 400: ErrorSchema, 404: ErrorSchema },
        },
      },
      async (request) => service.setPeriods(request.params.id, request.body.periods),
    );

    app.delete(
      '/symbols/:id',
      {
        schema: {
          tags: ['symbols'],
          summary: 'Remove a symbol',
          params: SymbolIdParamSchema,
          response: { 204: Type.Null(), 400: ErrorSchema },
        },
      },
      async (request, reply) => {
        await service.remove(request.params.id);
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/symbols/:id/state',
      {
        schema: {
          tags: ['symbols'],
          summary: "Get the symbol's current rule-engine state map for a profile",
          params: SymbolIdParamSchema,
          querystring: SymbolStateQuerySchema,
          response: { 200: Type.Record(Type.String(), StateValueSchema), 404: ErrorSchema },
        },
      },
      async (request) => service.listSymbolState(request.query.profileId, request.params.id),
    );

    if (stateHistory) {
      app.get(
        '/symbols/:id/state-keys',
        {
          schema: {
            tags: ['symbols'],
            summary: 'List known state keys for a watched symbol',
            params: SymbolIdParamSchema,
            response: { 200: Type.Array(StateKeyDescriptorSchema), 404: ErrorSchema },
          },
        },
        async (request) => {
          await assertSymbolWatched(service, request.params.id);
          return stateHistory.listKeys(request.params.id);
        },
      );

      app.get(
        '/symbols/:id/state/:key/series',
        {
          schema: {
            tags: ['symbols'],
            summary: "Read one state key's time-series for a watched symbol",
            params: StateHistorySeriesParamsSchema,
            querystring: StateHistorySeriesQuerySchema,
            response: { 200: Type.Array(StateHistoryEntrySchema), 404: ErrorSchema },
          },
        },
        async (request) => {
          await assertSymbolWatched(service, request.params.id);
          return stateHistory.series(request.params.id, request.params.key, {
            from: request.query.from,
            to: request.query.to,
          });
        },
      );
    }
  };
}

/**
 * Throw {@link SymbolNotFoundError} when `id` is not on the watchlist.
 *
 * Reuses the existing app-level error mapping that turns this into a 404.
 * Keeps the state-history routes in lockstep with the rest of the symbol
 * surface (the same 404 envelope as `GET /symbols/:id/state`).
 */
async function assertSymbolWatched(service: SymbolService, id: string): Promise<void> {
  const existing = await service.get(id);
  if (existing === null) {
    throw new SymbolNotFoundError(`symbol not watched: ${id}`);
  }
}
