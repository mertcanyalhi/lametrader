import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  type IndicatorComputeResult,
  type IndicatorDefinition,
  IndicatorNotFoundError,
} from '@lametrader/core';
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
import type { DeepMutable } from '../util/deep-mutable.js';

/**
 * Register the RESTful indicator routes — the catalog (`/indicators[/:key]`) and the ad-hoc compute route (`GET /symbols/:id/indicators/:key`).
 *
 * Catalog responses serialize registered `IndicatorDefinition`s only — never the `compute` function.
 *
 * Unknown indicator keys throw `IndicatorNotFoundError`; the app's error handler maps it to HTTP 404.
 *
 * @param registry - the indicator registry to read from.
 * @param compute - the compute use-case driving the symbol-scoped route.
 */
export function indicatorsController(
  registry: IndicatorRegistry,
  compute: IndicatorComputeService,
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
      // The domain uses `readonly` arrays inside `IndicatorDefinition` (to preserve
      // `as const` literal-type inference for `InferInputs<I>`); the TypeBox response
      // schema infers mutable arrays. `DeepMutable<T>` is the precise structural cast
      // — type-only, zero runtime cost — capturing that the two shapes are identical
      // at runtime modulo the readonly modifier.
      async () => registry.list() as DeepMutable<IndicatorDefinition[]>,
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
        return module.definition as DeepMutable<IndicatorDefinition>;
      },
    );

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
        return (await compute.compute(id, key, inputs, period, {
          from,
          to,
        })) as DeepMutable<IndicatorComputeResult>;
      },
    );
  };
}
