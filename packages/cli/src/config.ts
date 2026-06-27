import { parseArgs } from 'node:util';
import type { Notifier } from '@lametrader/core';
import type { ConfigService, TelegramDestinationsService } from '@lametrader/engine';
import { runConfigNotifications } from './config-notifications.js';

/**
 * Dependencies of the `config` CLI command group.
 */
export interface ConfigCliDeps {
  /** The scalar configuration use-case (drives `config get` / `config set`). */
  config: ConfigService;
  /** The Telegram destinations use-case (drives `config notifications telegram …`). */
  telegramDestinations: TelegramDestinationsService;
  /** Optional notifier used by `config notifications telegram test`. */
  notifier?: Notifier;
}

/**
 * Run the `config` CLI command group and return the output to print.
 *
 * - `get` → the current config as JSON.
 * - `set --periods 1h,1d --default-period 1d` → replace, then echo the result.
 * - `notifications telegram <list|set|delete|test>` → delegate to the
 *   destinations subgroup (see {@link runConfigNotifications}).
 *
 * @param argv - arguments after `config` (e.g. `['set', '--periods', '1h,1d']`).
 * @param deps - the configuration + destinations use-cases.
 */
export async function runConfig(argv: string[], deps: ConfigCliDeps): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case 'get':
      return JSON.stringify(await deps.config.get(), null, 2);
    case 'set': {
      const { values } = parseArgs({
        args: rest,
        options: {
          periods: { type: 'string' },
          'default-period': { type: 'string' },
        },
      });
      const result = await deps.config.replace({
        periods: values.periods?.split(','),
        defaultPeriod: values['default-period'],
      });
      return JSON.stringify(result, null, 2);
    }
    case 'notifications':
      return runConfigNotifications(rest, deps.telegramDestinations, deps.notifier);
    default:
      throw new Error(`unknown config subcommand: ${subcommand ?? '(none)'}`);
  }
}
