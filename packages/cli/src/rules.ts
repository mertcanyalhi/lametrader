import { parseArgs } from 'node:util';
import type { RuleService } from '@lametrader/engine';

/**
 * The recognized subcommands of the `rules` CLI command.
 */
enum RulesSubcommand {
  /** List rules (optionally filtered). */
  List = 'list',
  /** Show one rule by id. */
  Show = 'show',
}

/**
 * Run the `rules` CLI command against a {@link RuleService} and return the
 * output to print.
 *
 * Subcommands:
 *
 * - `list [--profile <id>] [--symbol <id>] [--enabled]` — list rules sorted
 *   ascending by `order`. Filters narrow by profile and/or symbol scope and
 *   (with `--enabled`) keep only enabled rules.
 * - `show <id>` — fetch one rule by id.
 *
 * Output is JSON for both subcommands so the result can be piped or
 * round-tripped through `jq`. Errors (unknown profile / rule) propagate to
 * the entry point, which prints `error: <message>` and exits non-zero.
 *
 * @param argv - arguments after `rules`.
 * @param service - the rules use-case to drive.
 */
export async function runRules(argv: string[], service: RuleService): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case RulesSubcommand.List: {
      const { values } = parseArgs({
        args: rest,
        options: {
          profile: { type: 'string' },
          symbol: { type: 'string' },
          enabled: { type: 'boolean' },
        },
      });
      const filters: { profileId?: string; symbolId?: string } = {};
      if (values.profile !== undefined) filters.profileId = values.profile;
      if (values.symbol !== undefined) filters.symbolId = values.symbol;
      const rules = await service.list(filters);
      const sorted = [...rules].sort((a, b) => a.order - b.order);
      const filtered = values.enabled ? sorted.filter((rule) => rule.enabled) : sorted;
      return json(filtered);
    }
    case RulesSubcommand.Show: {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const id = positionals[0];
      if (!id) throw new Error('show requires an id');
      return json(await service.get(id));
    }
    default:
      throw new Error(`unknown rules subcommand: ${subcommand ?? '(none)'}`);
  }
}

/** Pretty-print a value as JSON. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
