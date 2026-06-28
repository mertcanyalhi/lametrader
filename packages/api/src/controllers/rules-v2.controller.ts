import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { RulesV2 } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';

import { ErrorSchema } from '../schemas/common.schema.js';
import {
  ConditionNodeV2Schema,
  RuleEventEntryV2Schema,
  RuleV2EventsQuerySchema,
  RuleV2IdParamSchema,
  RuleV2InputSchema,
  RuleV2ListQuerySchema,
  RuleV2PatchSchema,
  RuleV2Schema,
  SymbolV2IdParamSchema,
} from '../schemas/rule-v2.schema.js';

/**
 * The v2 error envelope. Adds a per-field `fields[]` array to the existing
 * `{ error }` shape so multi-field validation failures surface as one entry
 * per offending path (per `specs/rules-v2-rest-api.spec.md` AC #2 and the
 * global error handler in `app.ts`).
 */
const FieldErrorSchema = Type.Object(
  {
    error: Type.String(),
    fields: Type.Array(
      Type.Object({ path: Type.String(), message: Type.String() }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);

/**
 * Register the `/v2/rules*` resource against a {@link RulesV2.RuleServiceV2}.
 *
 * Mounted under the `/v2` prefix in `app.ts` so v1 (`/rules`) and v2
 * (`/v2/rules`) coexist behind the feature flag per ADR 0016.
 *
 * @param service - the v2 rules use-case to drive.
 */
export function rulesV2Controller(service: RulesV2.RuleServiceV2) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    // Register the recursive `ConditionNodeV2` schema so its `Type.Ref`
    // resolves when Fastify-AJV builds the per-route validators.
    app.addSchema(ConditionNodeV2Schema);

    app.get(
      '/rules',
      {
        schema: {
          tags: ['rules-v2'],
          summary: 'List v2 rules (filterable by profileId / symbolId / enabled)',
          querystring: RuleV2ListQuerySchema,
          response: { 200: Type.Array(RuleV2Schema) },
        },
      },
      async (request) => service.list(request.query),
    );

    app.post(
      '/rules',
      {
        schema: {
          tags: ['rules-v2'],
          summary: 'Create a v2 rule',
          body: RuleV2InputSchema,
          response: { 201: RuleV2Schema, 400: FieldErrorSchema },
        },
      },
      async (request, reply) => {
        const created = await service.create(request.body as RulesV2.RuleV2CreateInput);
        reply.code(201).send(created);
      },
    );

    app.get(
      '/rules/:id',
      {
        schema: {
          tags: ['rules-v2'],
          summary: 'Get one v2 rule by id',
          params: RuleV2IdParamSchema,
          response: { 200: RuleV2Schema, 404: ErrorSchema },
        },
      },
      async (request) => service.get(request.params.id),
    );

    app.patch(
      '/rules/:id',
      {
        schema: {
          tags: ['rules-v2'],
          summary: 'Patch a v2 rule (partial merge; re-validates the merged result)',
          params: RuleV2IdParamSchema,
          body: RuleV2PatchSchema,
          response: { 200: RuleV2Schema, 400: FieldErrorSchema, 404: ErrorSchema },
        },
      },
      async (request) =>
        service.patch(request.params.id, request.body as Partial<RulesV2.RuleV2CreateInput>),
    );

    app.delete(
      '/rules/:id',
      {
        schema: {
          tags: ['rules-v2'],
          summary: 'Delete a v2 rule',
          params: RuleV2IdParamSchema,
          response: { 204: Type.Null(), 404: ErrorSchema },
        },
      },
      async (request, reply) => {
        await service.remove(request.params.id);
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/rules/:id/events',
      {
        schema: {
          tags: ['rules-v2'],
          summary: 'Read one v2 rule’s mirrored events log (newest-first)',
          params: RuleV2IdParamSchema,
          querystring: RuleV2EventsQuerySchema,
          response: { 200: Type.Array(RuleEventEntryV2Schema), 404: ErrorSchema },
        },
      },
      async (request) => service.listEvents(request.params.id, request.query),
    );

    app.get(
      '/symbols/:id/rule-events',
      {
        schema: {
          tags: ['rules-v2'],
          summary: 'Read one symbol’s mirrored v2 rule events log (newest-first)',
          params: SymbolV2IdParamSchema,
          querystring: RuleV2EventsQuerySchema,
          response: { 200: Type.Array(RuleEventEntryV2Schema) },
        },
      },
      async (request) => service.listSymbolEvents(request.params.id, request.query),
    );
  };
}
