import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { StateRepository } from '@lametrader/core';
import type { FastifyInstance } from 'fastify';
import { StateValueSchema } from '../schemas/rule.schema.js';

/**
 * Register the read endpoints of the `/state` resource against a
 * {@link StateRepository}.
 *
 * Currently exposes the global state map only — the per-symbol state map
 * lives under `/symbols/:id/state` (sub-resource of symbols).
 *
 * @param state - the rule-engine state store to drive.
 */
export function stateController(state: StateRepository) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/state/global',
      {
        schema: {
          tags: ['rules'],
          summary: 'Get the current global rule-engine state map',
          response: { 200: Type.Record(Type.String(), StateValueSchema) },
        },
      },
      async () => state.listGlobalState(),
    );
  };
}
