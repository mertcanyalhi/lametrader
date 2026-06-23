import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';

/**
 * Register the read endpoints of the `/telegram` resource.
 *
 * Currently exposes only `GET /telegram/destinations` returning the list of
 * configured destination names (no bot tokens / chat ids — those are
 * sensitive and never leave the server). The rule editor's
 * `NotifyTelegram` action picker reads this to populate its destination
 * dropdown.
 *
 * Lazy: read-only; the CRUD surface lands with #179 / #257.
 *
 * @param destinationNames - the configured destination names, in order.
 */
export function telegramController(destinationNames: string[]) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/telegram/destinations',
      {
        schema: {
          tags: ['rules'],
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
