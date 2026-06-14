import { parseArgs } from 'node:util';
import { ProfileScope } from '@lametrader/core';
import type { ProfileService } from '@lametrader/engine';

/**
 * Run the `profile` CLI command against a {@link ProfileService} and return the
 * output to print.
 *
 * - `list` → all profiles as JSON.
 * - `create --name <n> [--description <d>] [--disabled] [--symbols a,b]` → create,
 *   echo the profile (omitting `--symbols` keeps the default `all` scope).
 * - `update <id> [--name <n>] [--description <d>] [--enable|--disable]
 *   [--all|--symbols a,b]` → patch the given fields, echo the profile.
 * - `delete <id>` → remove it.
 *
 * @param argv - arguments after `profile`.
 * @param service - the profiles use-case to drive.
 */
export async function runProfiles(argv: string[], service: ProfileService): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case 'list':
      return json(await service.list());
    case 'create': {
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
    case 'update': {
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
    case 'delete': {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const id = positionals[0];
      if (!id) throw new Error('delete requires an id');
      await service.remove(id);
      return `deleted ${id}`;
    }
    default:
      throw new Error(`unknown profile subcommand: ${subcommand ?? '(none)'}`);
  }
}

/**
 * Pretty-print a value as JSON.
 */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
