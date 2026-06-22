import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { RuleCreateInput, RuleService } from '@lametrader/engine';

/**
 * The recognized subcommands of the `rules` CLI command.
 */
enum RulesSubcommand {
  /** List rules (optionally filtered). */
  List = 'list',
  /** Show one rule by id. */
  Show = 'show',
  /** Create a rule from a JSON file. */
  Create = 'create',
  /** Replace a rule by id from a JSON file. */
  Update = 'update',
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
 * - `create --profile <id> --file <path>` — read a JSON `RuleCreateInput`
 *   from the file, optionally override `profileId` with `--profile`, and
 *   create it via the service (validated). Echoes the created rule.
 * - `update <id> --file <path>` — read a JSON `RuleCreateInput` and replace
 *   the rule's mutable fields. Echoes the updated rule.
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
    case RulesSubcommand.Create: {
      const { values } = parseArgs({
        args: rest,
        options: { profile: { type: 'string' }, file: { type: 'string' } },
      });
      if (!values.file) throw new Error('create requires --file');
      const body = await readRuleInput(values.file);
      const input: RuleCreateInput =
        values.profile !== undefined ? { ...body, profileId: values.profile } : body;
      return json(await service.create(input));
    }
    case RulesSubcommand.Update: {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { file: { type: 'string' } },
      });
      const id = positionals[0];
      if (!id) throw new Error('update requires an id');
      if (!values.file) throw new Error('update requires --file');
      const body = await readRuleInput(values.file);
      return json(await service.replace(id, body));
    }
    default:
      throw new Error(`unknown rules subcommand: ${subcommand ?? '(none)'}`);
  }
}

/**
 * Read and parse a JSON file as a {@link RuleCreateInput}. The parser is
 * deliberately permissive at this layer — the service's `validateRule`
 * (cross-field invariants) and the API's TypeBox schema (shape) catch any
 * malformed input downstream with a precise error message.
 */
async function readRuleInput(path: string): Promise<RuleCreateInput> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as RuleCreateInput;
}

/** Pretty-print a value as JSON. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
