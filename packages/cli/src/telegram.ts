import { parseArgs } from 'node:util';
import type { Notifier } from '@lametrader/core';
import type { TelegramDestination } from '@lametrader/engine';

/**
 * The recognized subcommands of the `telegram` CLI command.
 */
enum TelegramSubcommand {
  /** List configured destinations with `botToken` redacted. */
  List = 'list',
  /** Send a one-off message to a configured destination. */
  Test = 'test',
}

/**
 * Run the `telegram` CLI command against the configured destinations from
 * the settings layer.
 *
 * Subcommands:
 *
 * - `list` — print configured destinations as `<name>  <chatId>  <redacted token>`,
 *   one per line. `(none)` when no destinations are configured. The full
 *   token is never printed; only the last 4 characters are shown.
 * - `test --destination <name> --message <text>` — send a one-off message
 *   via the {@link Notifier} port; validates settings end-to-end before
 *   any rule fires. Prints `sent` on success; `UnknownDestinationError` /
 *   `TelegramSendError` propagate to the entry point as non-zero exits.
 *
 * @param argv - arguments after `telegram`.
 * @param destinations - the resolved telegram destinations from settings.
 * @param notifier - the {@link Notifier} the `test` subcommand sends through.
 *   Optional — `list` doesn't need it; the entry point passes a real
 *   `TelegramNotifier` when wired.
 */
export async function runTelegram(
  argv: string[],
  destinations: readonly TelegramDestination[],
  notifier?: Notifier,
): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case TelegramSubcommand.List:
      if (destinations.length === 0) return '(none)';
      return destinations.map((d) => `${d.name}\t${d.chatId}\t${redact(d.botToken)}`).join('\n');
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

/**
 * Redact a bot token down to its last 4 characters, e.g. `****abcd`.
 * For tokens shorter than 4 chars (only happens in tests), returns
 * `****` with no tail.
 */
function redact(token: string): string {
  const tail = token.length >= 4 ? token.slice(-4) : '';
  return `****${tail}`;
}
