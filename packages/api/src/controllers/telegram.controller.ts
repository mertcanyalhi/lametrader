import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { TelegramDestinationsService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema } from '../schemas/common.schema.js';

/** Read shape — name + chatId only (bot tokens stay server-side). */
const TelegramDestinationSummarySchema = Type.Object(
  { name: Type.String(), chatId: Type.String() },
  { additionalProperties: false, $id: 'TelegramDestinationSummary' },
);

/** Write shape for `POST /notification/telegram/destinations`. */
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
 * Register the CRUD endpoints for the Telegram notification adapter under
 * the shared `/notification` prefix.
 *
 * - `GET /notification/telegram/destinations` — list (no bot tokens).
 * - `POST /notification/telegram/destinations` — upsert by `name`.
 * - `DELETE /notification/telegram/destinations/:name` — remove.
 *
 * Bot tokens are never read back from the server; the upsert returns the
 * non-sensitive summary projection. Domain failures map to 400 / 404 in
 * `app.ts`.
 *
 * @param service - the destinations use-case to drive.
 */
export function telegramController(service: TelegramDestinationsService) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/notification/telegram/destinations',
      {
        schema: {
          tags: ['notification'],
          summary: 'List configured Telegram destinations',
          response: { 200: Type.Array(TelegramDestinationSummarySchema) },
        },
      },
      async () => service.list(),
    );

    app.post(
      '/notification/telegram/destinations',
      {
        schema: {
          tags: ['notification'],
          summary: 'Upsert a Telegram destination',
          body: TelegramDestinationInputSchema,
          response: { 200: TelegramDestinationSummarySchema, 400: ErrorSchema },
        },
      },
      async (request) => service.upsert(request.body),
    );

    app.delete(
      '/notification/telegram/destinations/:name',
      {
        schema: {
          tags: ['notification'],
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
