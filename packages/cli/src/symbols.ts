import { parseArgs } from 'node:util';
import type { SymbolType } from '@lametrader/core';
import type { SymbolService } from '@lametrader/engine';

/**
 * Run the `symbols` CLI command against a {@link SymbolService} and return the
 * output to print.
 *
 * - `discover <query> [--type <t>]` → discovered symbols as JSON.
 * - `add <id> [--periods 1h,1d]` → add (validated), echo the watched symbol.
 * - `list [--enrich]` → the watchlist as JSON; with `--enrich`, each item carries a quote.
 * - `remove <id>` → remove it.
 * - `set-periods <id> --periods 1h,1d` → update periods, echo the symbol.
 *
 * @param argv - arguments after `symbols`.
 * @param service - the symbols use-case to drive.
 */
export async function runSymbols(argv: string[], service: SymbolService): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case 'discover': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { type: { type: 'string' } },
      });
      const query = positionals[0];
      if (!query) throw new Error('discover requires a query');
      return json(await service.discover(query, values.type as SymbolType | undefined));
    }
    case 'add': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { periods: { type: 'string' } },
      });
      const id = positionals[0];
      if (!id) throw new Error('add requires an id');
      return json(await service.add(id, values.periods?.split(',')));
    }
    case 'list': {
      const { values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { enrich: { type: 'boolean' } },
      });
      return json(await (values.enrich ? service.listWithQuotes() : service.list()));
    }
    case 'remove': {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const id = positionals[0];
      if (!id) throw new Error('remove requires an id');
      await service.remove(id);
      return `removed ${id}`;
    }
    case 'set-periods': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { periods: { type: 'string' } },
      });
      const id = positionals[0];
      if (!id) throw new Error('set-periods requires an id');
      if (!values.periods) throw new Error('set-periods requires --periods');
      return json(await service.setPeriods(id, values.periods.split(',')));
    }
    default:
      throw new Error(`unknown symbols subcommand: ${subcommand ?? '(none)'}`);
  }
}

/**
 * Pretty-print a value as JSON.
 */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
