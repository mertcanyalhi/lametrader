import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { IndicatorNotFoundError } from '@lametrader/core';
import type { IndicatorComputeService, IndicatorRegistry } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';
import {
  IndicatorComputeQuerySchema,
  IndicatorComputeResultSchema,
  IndicatorDefinitionSchema,
  IndicatorKeyParamSchema,
  SymbolIndicatorParamsSchema,
} from '../schemas/indicator.schema.js';

/**
 * Register the RESTful indicator routes — the catalog (`/indicators[/:key]`) and, when a compute service is provided, the ad-hoc compute route (`GET /symbols/:id/indicators/:key`).
 *
 * Catalog responses serialize registered `IndicatorDefinition`s only — never the `compute` function.
 *
 * Unknown indicator keys throw `IndicatorNotFoundError`; the app's error handler maps it to HTTP 404.
 *
 * @param registry - the indicator registry to read from.
 * @param compute - optional compute use-case; when present the symbol-scoped compute route is registered.
 */
export function indicatorsController(
  registry: IndicatorRegistry,
  compute?: IndicatorComputeService,
) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/indicators',
      {
        schema: {
          tags: ['indicators'],
          summary: 'List every registered indicator definition',
          response: { 200: Type.Array(IndicatorDefinitionSchema) },
        },
      },
      // Cast: the domain uses `readonly` arrays inside `IndicatorDefinition` (to preserve
      // `as const` literal-type inference for `InferInputs<I>`), while the TypeBox response
      // schema infers mutable arrays. The shape is identical at runtime; Fastify validates
      // it on serialize.
      async () => registry.list() as never,
    );

    app.get(
      '/indicators/:key',
      {
        schema: {
          tags: ['indicators'],
          summary: 'Get one indicator definition by key',
          params: IndicatorKeyParamSchema,
          response: { 200: IndicatorDefinitionSchema, 404: ErrorSchema },
        },
      },
      async (request) => {
        const module = registry.get(request.params.key);
        if (!module) {
          throw new IndicatorNotFoundError(`indicator not found: ${request.params.key}`);
        }
        return module.definition as never;
      },
    );

    if (compute) {
      app.get(
        '/symbols/:id/indicators/:key',
        {
          schema: {
            tags: ['indicators'],
            summary: "Compute an indicator over a symbol's stored candles",
            params: SymbolIndicatorParamsSchema,
            querystring: IndicatorComputeQuerySchema,
            response: {
              200: IndicatorComputeResultSchema,
              400: ErrorSchema,
              404: ErrorSchema,
            },
          },
        },
        async (request) => {
          const { id, key } = request.params;
          const { period, from, to, ...inputs } = request.query as {
            period: Parameters<IndicatorComputeService['compute']>[3];
            from?: number;
            to?: number;
          } & Record<string, unknown>;
          return (await compute.compute(id, key, inputs, period, { from, to })) as never;
        },
      );
    }
  };
}
