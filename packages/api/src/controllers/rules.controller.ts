import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { RuleCreateInput, RuleService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';
import {
  ConditionNodeSchema,
  RuleIdParamSchema,
  RuleInputSchema,
  RuleSchema,
} from '../schemas/rule.schema.js';

/**
 * Optional `?profileId=&symbolId=` query filter for `GET /rules`. Both are
 * optional and combinable; with neither set the endpoint returns every stored
 * rule.
 */
const RuleListQuerySchema = Type.Object(
  {
    profileId: Type.Optional(Type.String()),
    symbolId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Register the read endpoints of the `/rules` resource against a
 * {@link RuleService}.
 *
 * Mounts the rule schemas (including the self-referential `ConditionNode`)
 * once per controller instance so they're available for response-shape
 * validation and OpenAPI rendering.
 *
 * @param service - the rules use-case to drive.
 */
export function rulesController(service: RuleService) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    // Register the recursive `ConditionNode` schema so its `Type.Ref` resolves
    // when Fastify-AJV builds the per-route validators. Other nested shapes
    // are inlined and don't need a separate `$id`.
    app.addSchema(ConditionNodeSchema);

    app.get(
      '/rules',
      {
        schema: {
          tags: ['rules'],
          summary: 'List rules (optionally filtered by profileId and / or symbolId)',
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
          response: { 201: RuleSchema, 400: ErrorSchema },
        },
      },
      async (request, reply) => {
        // The TypeBox schema validates the transport-level (flat) shape; the
        // domain's `validateRule` (run inside `service.create`) enforces the
        // discriminated-union cross-field invariants.
        const rule = await service.create(request.body as unknown as RuleCreateInput);
        reply.code(201);
        return rule;
      },
    );

    app.get(
      '/rules/:id',
      {
        schema: {
          tags: ['rules'],
          summary: 'Get a rule',
          params: RuleIdParamSchema,
          response: { 200: RuleSchema, 404: ErrorSchema },
        },
      },
      async (request) => service.get(request.params.id),
    );

    app.put(
      '/rules/:id',
      {
        schema: {
          tags: ['rules'],
          summary: 'Replace a rule (full update)',
          params: RuleIdParamSchema,
          body: RuleInputSchema,
          response: { 200: RuleSchema, 400: ErrorSchema, 404: ErrorSchema },
        },
      },
      async (request) =>
        service.replace(request.params.id, request.body as unknown as RuleCreateInput),
    );
  };
}
