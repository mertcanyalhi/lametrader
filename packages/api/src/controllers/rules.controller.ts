import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { RuleEventEntry } from '@lametrader/core';
import type { RuleCreateInput, RuleService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';

import { ErrorSchema } from '../schemas/common.schema.js';
import {
  ConditionNodeSchema,
  RuleEventEntrySchema,
  RuleEventsQuerySchema,
  RuleIdParamSchema,
  RuleInputSchema,
  RuleListQuerySchema,
  RulePatchSchema,
  RuleSchema,
  SymbolIdParamSchema,
} from '../schemas/rule.schema.js';

/**
 * The rules-resource error envelope. Adds a per-field `fields[]` array to
 * the existing `{ error }` shape so multi-field validation failures surface
 * as one entry per offending path (per `specs/rules-rest-api.spec.md` AC #2
 * and the global error handler in `app.ts`).
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
 * Register the `/rules*` resource against a {@link RuleService}.
 *
 * Mounted at the API root in `app.ts`.
 *
 * @param service - the rules use-case to drive.
 */
export function rulesController(service: RuleService) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    // Register the recursive `ConditionNode` schema so its `Type.Ref`
    // resolves when Fastify-AJV builds the per-route validators.
    app.addSchema(ConditionNodeSchema);

    app.get(
      '/rules',
      {
        schema: {
          tags: ['rules'],
          summary: 'List rules (filterable by profileId / symbolId / enabled)',
          querystring: RuleListQuerySchema,
          response: { 200: Type.Array(RuleSchema) },
        },
      },
      async (request) => service.list(request.query),
    );

    app.post(
      '/rules',
      {
        schema: {
          tags: ['rules'],
          summary: 'Create a rule',
          body: RuleInputSchema,
          response: { 201: RuleSchema, 400: FieldErrorSchema },
        },
      },
      async (request, reply) => {
        const created = await service.create(request.body as RuleCreateInput);
        reply.code(201).send(created);
      },
    );

    app.get(
      '/rules/:id',
      {
        schema: {
          tags: ['rules'],
          summary: 'Get one rule by id',
          params: RuleIdParamSchema,
          response: { 200: RuleSchema, 404: ErrorSchema },
        },
      },
      async (request) => service.get(request.params.id),
    );

    app.patch(
      '/rules/:id',
      {
        schema: {
          tags: ['rules'],
          summary: 'Patch a rule (partial merge; re-validates the merged result)',
          params: RuleIdParamSchema,
          body: RulePatchSchema,
          response: { 200: RuleSchema, 400: FieldErrorSchema, 404: ErrorSchema },
        },
      },
      async (request) => service.patch(request.params.id, request.body as Partial<RuleCreateInput>),
    );

    app.delete(
      '/rules/:id',
      {
        schema: {
          tags: ['rules'],
          summary: 'Delete a rule',
          params: RuleIdParamSchema,
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
          tags: ['rules'],
          summary: 'Read one rule events log (newest-first)',
          params: RuleIdParamSchema,
          querystring: RuleEventsQuerySchema,
          response: { 200: Type.Array(RuleEventEntrySchema), 404: ErrorSchema },
        },
      },
      async (request): Promise<RuleEventEntry[]> =>
        service.listEvents(request.params.id, request.query),
    );

    app.get(
      '/symbols/:id/rule-events',
      {
        schema: {
          tags: ['rules'],
          summary: 'Read one symbol mirrored rule events log (newest-first)',
          params: SymbolIdParamSchema,
          querystring: RuleEventsQuerySchema,
          response: { 200: Type.Array(RuleEventEntrySchema) },
        },
      },
      async (request): Promise<RuleEventEntry[]> =>
        service.listSymbolEvents(request.params.id, request.query),
    );

    app.get(
      '/symbols/:id/rule-events/count',
      {
        schema: {
          tags: ['rules'],
          summary: 'Count one symbol mirrored rule events',
          params: SymbolIdParamSchema,
          response: {
            200: Type.Object(
              { count: Type.Integer({ minimum: 0 }) },
              { additionalProperties: false },
            ),
          },
        },
      },
      async (request): Promise<{ count: number }> => ({
        count: await service.countSymbolEvents(request.params.id),
      }),
    );
  };
}
