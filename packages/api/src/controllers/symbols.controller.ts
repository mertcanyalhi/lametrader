import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { SymbolService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';
import { RuleEventEntrySchema, StateValueSchema } from '../schemas/rule.schema.js';
import {
  AddSymbolSchema,
  DiscoverQuerySchema,
  EnrichedSymbolSchema,
  InstrumentSchema,
  ListSymbolsQuerySchema,
  PatchSymbolSchema,
  SymbolIdParamSchema,
  WatchedSymbolSchema,
} from '../schemas/symbol.schema.js';

/**
 * Optional `?limit=&before=` query for `GET /symbols/:id/rule-events`.
 * `limit` is clamped to `[1, 500]`; `before` is an epoch-ms cursor.
 */
const SymbolEventsQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    before: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

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
 * Register the RESTful symbol routes against a {@link SymbolService}.
 *
 * Schemas (TypeBox) validate input at the boundary and type the handlers;
 * domain failures (`SymbolError` → 400, `SymbolNotFoundError` → 404) are mapped by
 * the app's error handler. Response schemas pin the output and feed OpenAPI.
 *
 * @param service - the symbols use-case to drive.
 */
export function symbolsController(service: SymbolService) {
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
      '/symbols/:id/rule-events',
      {
        schema: {
          tags: ['symbols'],
          summary: "List a symbol's embedded rule-engine events newest-first (paginated)",
          params: SymbolIdParamSchema,
          querystring: SymbolEventsQuerySchema,
          response: { 200: Type.Array(RuleEventEntrySchema), 404: ErrorSchema },
        },
      },
      async (request) => service.listEventsForSymbol(request.params.id, request.query),
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
  };
}
