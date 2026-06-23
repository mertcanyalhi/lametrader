import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';

/**
 * Register the read endpoints for the Telegram notification adapter under
 * the shared `/notification` prefix.
 *
 * Currently exposes only `GET /notification/telegram/destinations` returning
 * the configured destination names (no bot tokens / chat ids — those are
 * sensitive and never leave the server). The rule editor's `NotifyTelegram`
 * action picker reads this to populate its destination dropdown.
 *
 * The `/notification` prefix is shared by every notifier adapter — a future
 * Discord adapter would expose its own routes under
 * `/notification/discord/...` etc.
 *
 * Lazy: read-only; the CRUD surface lands with #179 / #257.
 *
 * @param destinationNames - the configured destination names, in order.
 */
export function telegramController(destinationNames: string[]) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/notification/telegram/destinations',
      {
        schema: {
          tags: ['notification'],
          summary: 'List configured Telegram destination names',
          response: {
            200: Type.Array(Type.Object({ name: Type.String() }, { additionalProperties: false })),
          },
        },
      },
      async () => destinationNames.map((name) => ({ name })),
    );
  };
}
