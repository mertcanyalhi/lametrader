import { parseArgs } from 'node:util';
import type { Notifier } from '@lametrader/core';
import type { TelegramDestinationsService } from '@lametrader/engine';

/**
 * The recognized subcommands of the `telegram` CLI command.
 */
enum TelegramSubcommand {
  /** List configured destinations (name + chat id; bot tokens stay server-side). */
  List = 'list',
  /** Send a one-off message to a configured destination. */
  Test = 'test',
}

/**
 * Run the `telegram` CLI command against the destinations service.
 *
 * Subcommands:
 *
 * - `list` — print configured destinations as `<name>  <chatId>`, one per
 *   line. `(none)` when no destinations are configured. The CLI reads
 *   through the service so freshly upserted destinations show up immediately.
 * - `test --destination <name> --message <text>` — send a one-off message
 *   via the {@link Notifier} port; validates the wired destinations
 *   end-to-end before any rule fires. Prints `sent` on success;
 *   `UnknownDestinationError` / `TelegramSendError` propagate to the entry
 *   point as non-zero exits.
 *
 * @param argv - arguments after `telegram`.
 * @param destinations - the destinations use-case (read source for `list`).
 * @param notifier - the {@link Notifier} the `test` subcommand sends through.
 *   Optional — `list` doesn't need it; the entry point passes a real
 *   `TelegramNotifier` when wired.
 */
export async function runTelegram(
  argv: string[],
  destinations: TelegramDestinationsService,
  notifier?: Notifier,
): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case TelegramSubcommand.List: {
      const listed = await destinations.list();
      if (listed.length === 0) return '(none)';
      return listed.map((d) => `${d.name}\t${d.chatId}`).join('\n');
    }
    case TelegramSubcommand.Test: {
      if (!notifier) {
        throw new Error('telegram test requires the notifier port to be wired');
      }
      const { values } = parseArgs({
        args: rest,
        options: { destination: { type: 'string' }, message: { type: 'string' } },
      });
      if (!values.destination) throw new Error('telegram test requires --destination');
      if (!values.message) throw new Error('telegram test requires --message');
      await notifier.send(values.destination, values.message);
      return 'sent';
    }
    default:
      throw new Error(`unknown telegram subcommand: ${subcommand ?? '(none)'}`);
  }
}
