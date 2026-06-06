import { parseArgs } from 'node:util';
import type { ConfigService } from '@lametrader/engine';

/**
 * Run the `config` CLI command against a {@link ConfigService} and return the
 * output to print.
 *
 * - `get` → the current config as JSON.
 * - `set --periods 1h,1d --default-period 1d` → replace, then echo the result.
 *
 * @param argv - arguments after `config` (e.g. `['set', '--periods', '1h,1d']`).
 * @param service - the configuration use-case to drive.
 */
export async function runConfig(argv: string[], service: ConfigService): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case 'get':
      return JSON.stringify(await service.get(), null, 2);
    case 'set': {
      const { values } = parseArgs({
        args: rest,
        options: {
          periods: { type: 'string' },
          'default-period': { type: 'string' },
        },
      });
      const result = await service.replace({
        periods: values.periods?.split(','),
        defaultPeriod: values['default-period'],
      });
      return JSON.stringify(result, null, 2);
    }
    default:
      throw new Error(`unknown config subcommand: ${subcommand ?? '(none)'}`);
  }
}
