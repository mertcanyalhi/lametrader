import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { SymbolService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';
import {
  AddSymbolSchema,
  DiscoverQuerySchema,
  InstrumentSchema,
  PatchSymbolSchema,
  SymbolIdParamSchema,
  WatchedSymbolSchema,
} from '../schemas/symbol.schema.js';

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
          response: { 200: Type.Array(WatchedSymbolSchema) },
        },
      },
      async () => service.list(),
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
      { schema: { tags: ['symbols'], summary: 'Remove a symbol', params: SymbolIdParamSchema } },
      async (request, reply) => {
        await service.remove(request.params.id);
        return reply.code(204).send();
      },
    );
  };
}
