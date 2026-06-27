import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { TelegramDestinationsService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';

/** Read shape — name + chatId only (bot tokens stay server-side). */
const TelegramDestinationSummarySchema = Type.Object(
  { name: Type.String(), chatId: Type.String() },
  { additionalProperties: false, $id: 'TelegramDestinationSummary' },
);

/** Write shape for `POST /config/notifications/telegram`. */
const TelegramDestinationInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    botToken: Type.String({ minLength: 1 }),
    chatId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false, $id: 'TelegramDestinationInput' },
);

const TelegramDestinationNameParamSchema = Type.Object(
  { name: Type.String({ minLength: 1 }) },
  { additionalProperties: false, $id: 'TelegramDestinationNameParam' },
);

/**
 * Register the CRUD endpoints for notification destinations as a sub-resource
 * of `/config`. Telegram is the only adapter today; the `/config/notifications`
 * prefix keeps room for siblings (e.g. `/slack`) without growing top-level
 * routes.
 *
 * - `GET /config/notifications/telegram` — list (no bot tokens).
 * - `POST /config/notifications/telegram` — upsert by `name`.
 * - `DELETE /config/notifications/telegram/:name` — remove.
 *
 * Bot tokens are never read back from the server; the upsert returns the
 * non-sensitive summary projection. Domain failures map to 400 / 404 in
 * `app.ts`.
 *
 * @param service - the destinations use-case to drive.
 */
export function notificationsController(service: TelegramDestinationsService) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/config/notifications/telegram',
      {
        schema: {
          tags: ['config'],
          summary: 'List configured Telegram destinations',
          response: { 200: Type.Array(TelegramDestinationSummarySchema) },
        },
      },
      async () => service.list(),
    );

    app.post(
      '/config/notifications/telegram',
      {
        schema: {
          tags: ['config'],
          summary: 'Upsert a Telegram destination',
          body: TelegramDestinationInputSchema,
          response: { 200: TelegramDestinationSummarySchema, 400: ErrorSchema },
        },
      },
      async (request) => service.upsert(request.body),
    );

    app.delete(
      '/config/notifications/telegram/:name',
      {
        schema: {
          tags: ['config'],
          summary: 'Delete a Telegram destination by name',
          params: TelegramDestinationNameParamSchema,
          response: { 204: Type.Null(), 404: ErrorSchema },
        },
      },
      async (request, reply) => {
        await service.remove(request.params.name);
        reply.code(204);
        return null;
      },
    );
  };
}
