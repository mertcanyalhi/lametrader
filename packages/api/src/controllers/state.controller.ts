import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { StateRepository } from '@lametrader/core';
import type { FastifyInstance } from 'fastify';
import { StateValueSchema } from '../schemas/rule.schema.js';

/**
 * Path params for `/profiles/:profileId/state/global`.
 */
const ProfileIdParamSchema = Type.Object(
  {
    profileId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/**
 * Register the read endpoints of the `/state` sub-resource against a
 * {@link StateRepository}.
 *
 * State is partitioned by `profileId` (#281), so the global-state read sits
 * under the profile resource: `GET /profiles/:profileId/state/global`. The
 * per-symbol read lives under `/symbols/:id/state` (sub-resource of symbols,
 * with `profileId` as a required query param).
 *
 * @param state - the rule-engine state store to drive.
 */
export function stateController(state: StateRepository) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/profiles/:profileId/state/global',
      {
        schema: {
          tags: ['rules'],
          summary: 'Get the current global rule-engine state map for a profile',
          params: ProfileIdParamSchema,
          response: { 200: Type.Record(Type.String(), StateValueSchema) },
        },
      },
      async (request) => state.listGlobalState(request.params.profileId),
    );
  };
}
