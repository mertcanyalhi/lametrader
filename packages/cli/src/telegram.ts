import type { TelegramDestination } from '@lametrader/engine';

/**
 * The recognized subcommands of the `telegram` CLI command.
 */
enum TelegramSubcommand {
  /** List configured destinations with `botToken` redacted. */
  List = 'list',
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
 *
 * @param argv - arguments after `telegram`.
 * @param destinations - the resolved telegram destinations from settings.
 */
export async function runTelegram(
  argv: string[],
  destinations: readonly TelegramDestination[],
): Promise<string> {
  const [subcommand] = argv;
  switch (subcommand) {
    case TelegramSubcommand.List:
      if (destinations.length === 0) return '(none)';
      return destinations.map((d) => `${d.name}\t${d.chatId}\t${redact(d.botToken)}`).join('\n');
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
