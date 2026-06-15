import { parseArgs } from 'node:util';
import { ProfileScope } from '@lametrader/core';
import type { IndicatorInstanceInput, ProfileService } from '@lametrader/engine';

/**
 * The recognized subcommands of the `profile` CLI command.
 */
enum ProfileSubcommand {
  /** List every profile. */
  List = 'list',
  /** Create a new profile. */
  Create = 'create',
  /** Patch an existing profile. */
  Update = 'update',
  /** Remove a profile. */
  Delete = 'delete',
  /** Sub-group for managing attached indicator instances. */
  Indicators = 'indicators',
}

/**
 * The recognized subcommands of the `profile indicators` sub-group.
 */
enum ProfileIndicatorsSubcommand {
  /** List the profile's attached instances. */
  List = 'list',
  /** Attach a new instance. */
  Add = 'add',
  /** Full-replace an existing instance. */
  Update = 'update',
  /** Detach an instance. */
  Remove = 'remove',
}

/**
 * Run the `profile` CLI command against a {@link ProfileService} and return the output to print.
 *
 * Subcommands:
 *
 * - `list` — all profiles as JSON.
 * - `create --name <n> [--description <d>] [--disabled] [--symbols a,b]` — create, echo the profile (omitting `--symbols` keeps the default `all` scope).
 * - `update <id> [--name <n>] [--description <d>] [--enable|--disable] [--all|--symbols a,b]` — patch the given fields, echo the profile.
 * - `delete <id>` — remove it.
 * - `indicators <subcommand> ...` — manage attached indicators (see {@link runProfileIndicators}).
 *
 * @param argv - arguments after `profile`.
 * @param service - the profiles use-case to drive.
 */
export async function runProfiles(argv: string[], service: ProfileService): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case ProfileSubcommand.List:
      return json(await service.list());
    case ProfileSubcommand.Create: {
      const { values } = parseArgs({
        args: rest,
        options: {
          name: { type: 'string' },
          description: { type: 'string' },
          symbols: { type: 'string' },
          disabled: { type: 'boolean' },
        },
      });
      if (!values.name) throw new Error('create requires --name');
      return json(
        await service.create({
          name: values.name,
          ...(values.description !== undefined ? { description: values.description } : {}),
          ...(values.disabled ? { enabled: false } : {}),
          ...(values.symbols !== undefined
            ? { scope: { type: ProfileScope.Symbols, symbolIds: values.symbols.split(',') } }
            : {}),
        }),
      );
    }
    case ProfileSubcommand.Update: {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          name: { type: 'string' },
          description: { type: 'string' },
          symbols: { type: 'string' },
          all: { type: 'boolean' },
          enable: { type: 'boolean' },
          disable: { type: 'boolean' },
        },
      });
      const id = positionals[0];
      if (!id) throw new Error('update requires an id');
      const patch: Record<string, unknown> = {};
      if (values.name !== undefined) patch.name = values.name;
      if (values.description !== undefined) patch.description = values.description;
      if (values.enable) patch.enabled = true;
      if (values.disable) patch.enabled = false;
      if (values.all) patch.scope = { type: ProfileScope.All };
      if (values.symbols !== undefined) {
        patch.scope = { type: ProfileScope.Symbols, symbolIds: values.symbols.split(',') };
      }
      return json(await service.update(id, patch));
    }
    case ProfileSubcommand.Delete: {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const id = positionals[0];
      if (!id) throw new Error('delete requires an id');
      await service.remove(id);
      return `deleted ${id}`;
    }
    case ProfileSubcommand.Indicators:
      return runProfileIndicators(rest, service);
    default:
      throw new Error(`unknown profile subcommand: ${subcommand ?? '(none)'}`);
  }
}

/**
 * Run the `profile indicators` sub-group against a {@link ProfileService}.
 *
 * Subcommands:
 *
 * - `list <profileId>` — print the profile's attached instances as JSON.
 * - `add <profileId> --indicator-key <k> [--label <s>] [--inputs <json>]` — attach.
 * - `update <profileId> <instanceId> --indicator-key <k> [--label <s>] [--inputs <json>]` — full-replace.
 * - `remove <profileId> <instanceId>` — detach.
 */
async function runProfileIndicators(argv: string[], service: ProfileService): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case ProfileIndicatorsSubcommand.List: {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const profileId = positionals[0];
      if (!profileId) throw new Error('list requires a profileId');
      return json(await service.listIndicators(profileId));
    }
    case ProfileIndicatorsSubcommand.Add: {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          'indicator-key': { type: 'string' },
          label: { type: 'string' },
          inputs: { type: 'string' },
        },
      });
      const profileId = positionals[0];
      if (!profileId) throw new Error('add requires a profileId');
      return json(await service.addIndicator(profileId, parseIndicatorInput(values)));
    }
    case ProfileIndicatorsSubcommand.Update: {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          'indicator-key': { type: 'string' },
          label: { type: 'string' },
          inputs: { type: 'string' },
        },
      });
      const profileId = positionals[0];
      const instanceId = positionals[1];
      if (!profileId || !instanceId) throw new Error('update requires <profileId> <instanceId>');
      return json(
        await service.replaceIndicator(profileId, instanceId, parseIndicatorInput(values)),
      );
    }
    case ProfileIndicatorsSubcommand.Remove: {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const profileId = positionals[0];
      const instanceId = positionals[1];
      if (!profileId || !instanceId) throw new Error('remove requires <profileId> <instanceId>');
      await service.removeIndicator(profileId, instanceId);
      return `removed ${instanceId}`;
    }
    default:
      throw new Error(`unknown profile indicators subcommand: ${subcommand ?? '(none)'}`);
  }
}

/**
 * Parse the indicator-input flags into an {@link IndicatorInstanceInput}.
 */
function parseIndicatorInput(values: {
  'indicator-key'?: string;
  label?: string;
  inputs?: string;
}): IndicatorInstanceInput {
  const indicatorKey = values['indicator-key'];
  if (!indicatorKey) throw new Error('--indicator-key is required');
  const parsed: IndicatorInstanceInput = { indicatorKey };
  if (values.inputs !== undefined) {
    parsed.inputs = JSON.parse(values.inputs);
  }
  if (values.label !== undefined) {
    parsed.label = values.label;
  }
  return parsed;
}

/**
 * Pretty-print a value as JSON.
 */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
