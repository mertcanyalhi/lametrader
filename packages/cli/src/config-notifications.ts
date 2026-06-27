import { parseArgs } from 'node:util';
import type { Notifier } from '@lametrader/core';
import type { TelegramDestinationsService } from '@lametrader/engine';

/**
 * The recognized subcommands of `lametrader config notifications telegram`.
 */
enum TelegramSubcommand {
  /** List configured destinations (name + chat id; bot tokens stay server-side). */
  List = 'list',
  /** Upsert a destination by name. */
  Set = 'set',
  /** Delete a destination by name. */
  Delete = 'delete',
  /** Send a one-off message to a configured destination. */
  Test = 'test',
}

/**
 * Run the `config notifications` CLI subgroup against the destinations
 * use-case (and, for `test`, the wired {@link Notifier}).
 *
 * Today the only channel is Telegram, dispatched on the leading `telegram`
 * token — the `notifications` prefix is forward-compatible for siblings
 * (e.g. Slack) without growing top-level CLI commands.
 *
 * @param argv - arguments after `config notifications`.
 * @param destinations - the destinations use-case.
 * @param notifier - the {@link Notifier} used by `test` (optional; the entry
 *   point passes a real `TelegramNotifier`).
 */
export async function runConfigNotifications(
  argv: string[],
  destinations: TelegramDestinationsService,
  notifier?: Notifier,
): Promise<string> {
  const [channel, ...rest] = argv;
  if (channel !== 'telegram') {
    throw new Error(`unknown config notifications channel: ${channel ?? '(none)'}`);
  }
  return runConfigNotificationsTelegram(rest, destinations, notifier);
}

/**
 * Dispatch the `telegram` channel's subcommands.
 *
 * - `list` — print configured destinations as `<name>\t<chatId>`, one per
 *   line. `(none)` when no destinations are configured.
 * - `set --name <n> --bot-token <t> --chat-id <id>` — upsert a destination;
 *   prints `set <name>`.
 * - `delete --name <n>` — remove a destination; prints `deleted <name>`;
 *   `TelegramDestinationNotFoundError` propagates as a non-zero exit.
 * - `test --destination <name> --message <text>` — send a one-off message
 *   via the {@link Notifier} port; validates the wired destinations
 *   end-to-end before any rule fires. Prints `sent` on success.
 */
async function runConfigNotificationsTelegram(
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
    case TelegramSubcommand.Set: {
      const { values } = parseArgs({
        args: rest,
        options: {
          name: { type: 'string' },
          'bot-token': { type: 'string' },
          'chat-id': { type: 'string' },
        },
      });
      if (!values.name) throw new Error('telegram set requires --name');
      if (!values['bot-token']) throw new Error('telegram set requires --bot-token');
      if (!values['chat-id']) throw new Error('telegram set requires --chat-id');
      const summary = await destinations.upsert({
        name: values.name,
        botToken: values['bot-token'],
        chatId: values['chat-id'],
      });
      return `set ${summary.name}`;
    }
    case TelegramSubcommand.Delete: {
      const { values } = parseArgs({ args: rest, options: { name: { type: 'string' } } });
      if (!values.name) throw new Error('telegram delete requires --name');
      await destinations.remove(values.name);
      return `deleted ${values.name}`;
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
