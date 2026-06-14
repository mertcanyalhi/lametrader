import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { ProfileService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';
import {
  ProfileIdParamSchema,
  ProfileInputSchema,
  ProfilePatchSchema,
  ProfileSchema,
} from '../schemas/profile.schema.js';

/**
 * Register the RESTful `/profiles` routes against a {@link ProfileService}.
 *
 * Schemas (TypeBox) validate input at the boundary and type the handlers; domain
 * failures (`ProfileError` → 400, `ProfileNotFoundError` → 404,
 * `ProfileConflictError` → 409) are mapped by the app's error handler. Response
 * schemas pin the output and feed OpenAPI.
 *
 * @param service - the profiles use-case to drive.
 */
export function profilesController(service: ProfileService) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/profiles',
      {
        schema: {
          tags: ['profiles'],
          summary: 'List profiles',
          response: { 200: Type.Array(ProfileSchema) },
        },
      },
      async () => service.list(),
    );

    app.post(
      '/profiles',
      {
        schema: {
          tags: ['profiles'],
          summary: 'Create a profile',
          body: ProfileInputSchema,
          response: { 201: ProfileSchema, 400: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request, reply) => {
        const profile = await service.create(request.body);
        reply.code(201);
        return profile;
      },
    );

    app.get(
      '/profiles/:id',
      {
        schema: {
          tags: ['profiles'],
          summary: 'Get a profile',
          params: ProfileIdParamSchema,
          response: { 200: ProfileSchema, 404: ErrorSchema },
        },
      },
      async (request) => service.get(request.params.id),
    );

    app.put(
      '/profiles/:id',
      {
        schema: {
          tags: ['profiles'],
          summary: 'Replace a profile',
          params: ProfileIdParamSchema,
          body: ProfileInputSchema,
          response: { 200: ProfileSchema, 400: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request) => service.replace(request.params.id, request.body),
    );

    app.patch(
      '/profiles/:id',
      {
        schema: {
          tags: ['profiles'],
          summary: 'Update a profile',
          params: ProfileIdParamSchema,
          body: ProfilePatchSchema,
          response: { 200: ProfileSchema, 400: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request) => service.update(request.params.id, request.body),
    );

    app.delete(
      '/profiles/:id',
      {
        schema: {
          tags: ['profiles'],
          summary: 'Delete a profile',
          params: ProfileIdParamSchema,
          response: { 204: Type.Null(), 404: ErrorSchema },
        },
      },
      async (request, reply) => {
        await service.remove(request.params.id);
        return reply.code(204).send(null);
      },
    );
  };
}
