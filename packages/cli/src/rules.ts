import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { RuleCreateInput, RuleService, SymbolService } from '@lametrader/engine';

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
  /** Delete a rule by id. */
  Delete = 'delete',
  /** Flip a rule's `enabled` flag to true. */
  Enable = 'enable',
  /** Flip a rule's `enabled` flag to false. */
  Disable = 'disable',
  /** Bulk-renumber rule `order` to the given ids' 1-based positions. */
  Reorder = 'reorder',
  /** Paginated read of rule-firing events by rule id or by symbol. */
  Events = 'events',
}

/** Default page size when `--limit` is omitted on `rules events`. */
const DEFAULT_EVENTS_LIMIT = 20;

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
 * - `delete <id>` — remove the rule (cascades its persisted firing-state).
 *   Echoes `deleted <id>` on success.
 * - `enable <id>` / `disable <id>` — flip the rule's `enabled` flag and
 *   append an `Enabled` / `Disabled` history entry. Echoes the updated rule.
 * - `reorder --order <csv>` — bulk-renumber `order` to the 1-based
 *   positions of the comma-separated ids. Echoes the renumbered rules.
 * - `events <id> [--limit N]` / `events --symbol <id> [--limit N]` —
 *   paginated read of rule-firing events (default 20, max 500),
 *   newest-first, by rule id (positional) or by symbol (`--symbol`).
 *
 * Output is JSON for both subcommands so the result can be piped or
 * round-tripped through `jq`. Errors (unknown profile / rule) propagate to
 * the entry point, which prints `error: <message>` and exits non-zero.
 *
 * @param argv - arguments after `rules`.
 * @param service - the rules use-case to drive.
 * @param symbols - the symbols use-case, used by `events --symbol` to read
 *   the embedded events on the symbol document.
 */
export async function runRules(
  argv: string[],
  service: RuleService,
  symbols?: SymbolService,
): Promise<string> {
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
    case RulesSubcommand.Delete: {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const id = positionals[0];
      if (!id) throw new Error('delete requires an id');
      await service.remove(id);
      return `deleted ${id}`;
    }
    case RulesSubcommand.Enable: {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const id = positionals[0];
      if (!id) throw new Error('enable requires an id');
      return json(await service.setEnabled(id, true));
    }
    case RulesSubcommand.Disable: {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const id = positionals[0];
      if (!id) throw new Error('disable requires an id');
      return json(await service.setEnabled(id, false));
    }
    case RulesSubcommand.Reorder: {
      const { values } = parseArgs({
        args: rest,
        options: { order: { type: 'string' } },
      });
      if (!values.order) throw new Error('reorder requires --order (comma-separated ids)');
      const ids = values.order
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      if (ids.length === 0) throw new Error('reorder requires at least one id in --order');
      return json(await service.reorder(ids));
    }
    case RulesSubcommand.Events: {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          symbol: { type: 'string' },
          limit: { type: 'string' },
        },
      });
      const limit = parseLimit(values.limit);
      if (values.symbol !== undefined) {
        if (!symbols) {
          throw new Error('events --symbol requires the symbols use-case to be wired');
        }
        return json(await symbols.listEventsForSymbol(values.symbol, { limit }));
      }
      const id = positionals[0];
      if (!id) throw new Error('events requires a rule id (or --symbol <id>)');
      return json(await service.listEvents(id, { limit }));
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

/**
 * Parse a `--limit` flag value into an integer in `[1, 500]`. Defaults to
 * {@link DEFAULT_EVENTS_LIMIT} when absent; throws on a non-integer or an
 * out-of-range value so the caller surfaces a non-zero exit.
 */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_EVENTS_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 500) {
    throw new Error(`--limit must be an integer in [1, 500] (got ${raw})`);
  }
  return parsed;
}

/** Pretty-print a value as JSON. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
