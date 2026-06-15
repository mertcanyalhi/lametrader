import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { IndicatorNotFoundError } from '@lametrader/core';
import type { IndicatorRegistry } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';
import { IndicatorDefinitionSchema, IndicatorKeyParamSchema } from '../schemas/indicator.schema.js';

/**
 * Register the RESTful `/indicators` catalog routes against an {@link IndicatorRegistry}.
 *
 * The catalog serializes registered `IndicatorDefinition`s only — never the `compute` function.
 *
 * Unknown keys throw `IndicatorNotFoundError`, which the app's error handler maps to HTTP 404.
 *
 * @param registry - the indicator registry to read from.
 */
export function indicatorsController(registry: IndicatorRegistry) {
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
  };
}
