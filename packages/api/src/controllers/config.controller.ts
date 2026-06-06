import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { ConfigService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';
import { ConfigPatchSchema, ConfigSchema } from '../schemas/config.schema.js';

/**
 * Register the RESTful `/config` routes against a {@link ConfigService}.
 *
 * Schemas (TypeBox) validate input at the boundary and type the handler bodies;
 * cross-field/domain rules (e.g. `defaultPeriod` ∈ `periods`) are enforced by the
 * domain and surfaced as 400s by the app's error handler. Response schemas pin
 * the output contract and feed the OpenAPI document.
 *
 * @param service - the configuration use-case to drive.
 */
export function configController(service: ConfigService) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/config',
      {
        schema: {
          tags: ['config'],
          summary: 'Get the current config',
          response: { 200: ConfigSchema },
        },
      },
      async () => service.get(),
    );

    app.put(
      '/config',
      {
        schema: {
          tags: ['config'],
          summary: 'Replace the config',
          body: ConfigSchema,
          response: { 200: ConfigSchema, 400: ErrorSchema },
        },
      },
      async (request) => {
        const config = await service.replace(request.body);
        request.log.info({ config }, 'config replaced');
        return config;
      },
    );

    app.patch(
      '/config',
      {
        schema: {
          tags: ['config'],
          summary: 'Partially update the config',
          body: ConfigPatchSchema,
          response: { 200: ConfigSchema, 400: ErrorSchema },
        },
      },
      async (request) => {
        const config = await service.patch(request.body);
        request.log.info({ config }, 'config patched');
        return config;
      },
    );
  };
}
