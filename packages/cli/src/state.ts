import { parseArgs } from 'node:util';
import { type StateRepository, type StateValue, StateValueType } from '@lametrader/core';
import type { SymbolService } from '@lametrader/engine';

/**
 * The recognized subcommands of the `state` CLI command.
 */
enum StateSubcommand {
  /** List a symbol's state map (`--symbol`) or the global state map (`--global`). */
  List = 'list',
  /** Write a key (`--symbol|--global --key --value --type`). */
  Set = 'set',
  /** Remove a key (`--symbol|--global --key`). */
  Remove = 'remove',
}

/**
 * Run the `state` CLI command against a {@link SymbolService} (for the
 * symbol-scoped read, which validates the symbol is watched and routes
 * through the symbols use-case) and a {@link StateRepository} (for the
 * global-scope read).
 *
 * State is partitioned by profile (#281), so every subcommand requires
 * `--profile <id>`.
 *
 * Subcommands:
 *
 * - `list --profile <id> --symbol <id>` — print the symbol's current state map
 *   under the profile as JSON; `SymbolNotFoundError` propagates to the entry
 *   point as a non-zero exit.
 * - `list --profile <id> --global` — print the profile's global state map as
 *   JSON.
 * - `set --profile <id> --symbol <id>|--global --key <k> --value <v> --type <t>`
 *   — write a value under the profile (`string|number|bool|enum`); the type
 *   flag validates `--value` against the chosen variant. On success, prints
 *   the new state map.
 * - `remove --profile <id> --symbol <id>|--global --key <k>` — drop a key
 *   under the profile; on success prints the new state map (a no-op when the
 *   key was already absent).
 *
 * Exactly one of `--symbol` / `--global` must be provided for every
 * subcommand.
 *
 * @param argv - arguments after `state`.
 * @param symbols - the symbols use-case (drives the per-symbol read).
 * @param state - the state-store port (drives the global read).
 */
export async function runState(
  argv: string[],
  symbols: SymbolService,
  state: StateRepository,
): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case StateSubcommand.List: {
      const { values } = parseArgs({
        args: rest,
        options: {
          profile: { type: 'string' },
          symbol: { type: 'string' },
          global: { type: 'boolean' },
        },
      });
      const profileId = requireProfile(values.profile);
      if (values.symbol !== undefined && values.global) {
        throw new Error('state list: pass only one of --symbol or --global');
      }
      if (values.symbol !== undefined) {
        return json(await symbols.listSymbolState(profileId, values.symbol));
      }
      if (values.global) {
        return json(await state.listGlobalState(profileId));
      }
      throw new Error('state list requires --symbol <id> or --global');
    }
    case StateSubcommand.Set: {
      const { values } = parseArgs({
        args: rest,
        options: {
          profile: { type: 'string' },
          symbol: { type: 'string' },
          global: { type: 'boolean' },
          key: { type: 'string' },
          value: { type: 'string' },
          type: { type: 'string' },
        },
      });
      const profileId = requireProfile(values.profile);
      const scope = pickScope(values);
      if (!values.key) throw new Error('state set requires --key');
      if (values.value === undefined) throw new Error('state set requires --value');
      if (!values.type) throw new Error('state set requires --type (string|number|bool|enum)');
      const stateValue = parseStateValue(values.type, values.value);
      const ts = Date.now();
      if (scope.kind === 'symbol') {
        await state.setSymbolState(profileId, scope.symbolId, values.key, stateValue, ts);
        return json(await symbols.listSymbolState(profileId, scope.symbolId));
      }
      await state.setGlobalState(profileId, values.key, stateValue, ts);
      return json(await state.listGlobalState(profileId));
    }
    case StateSubcommand.Remove: {
      const { values } = parseArgs({
        args: rest,
        options: {
          profile: { type: 'string' },
          symbol: { type: 'string' },
          global: { type: 'boolean' },
          key: { type: 'string' },
        },
      });
      const profileId = requireProfile(values.profile);
      const scope = pickScope(values);
      if (!values.key) throw new Error('state remove requires --key');
      const ts = Date.now();
      if (scope.kind === 'symbol') {
        await state.removeSymbolState(profileId, scope.symbolId, values.key, ts);
        return json(await symbols.listSymbolState(profileId, scope.symbolId));
      }
      await state.removeGlobalState(profileId, values.key, ts);
      return json(await state.listGlobalState(profileId));
    }
    default:
      throw new Error(`unknown state subcommand: ${subcommand ?? '(none)'}`);
  }
}

/**
 * Validate that `--profile <id>` was supplied. Throws a readable error
 * otherwise.
 */
function requireProfile(profile: string | undefined): string {
  if (profile === undefined || profile === '') {
    throw new Error('state command requires --profile <id>');
  }
  return profile;
}

/**
 * Validate that exactly one of `--symbol` / `--global` was supplied and
 * narrow it to a typed scope. Throws a readable error otherwise.
 */
function pickScope(values: {
  symbol?: string;
  global?: boolean;
}): { kind: 'symbol'; symbolId: string } | { kind: 'global' } {
  if (values.symbol !== undefined && values.global) {
    throw new Error('pass only one of --symbol or --global');
  }
  if (values.symbol !== undefined) return { kind: 'symbol', symbolId: values.symbol };
  if (values.global) return { kind: 'global' };
  throw new Error('requires --symbol <id> or --global');
}

/**
 * Parse a `--value` flag against the explicit `--type`, building a
 * {@link StateValue} the repository can write. `bool` accepts `"true"`/`"false"`
 * (case-insensitive); `number` must parse as a finite number;
 * `string` / `enum` round-trip the raw value.
 */
function parseStateValue(type: string, raw: string): StateValue {
  switch (type) {
    case StateValueType.String:
      return { type: StateValueType.String, value: raw };
    case StateValueType.Number: {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`--type number requires a finite numeric --value (got ${raw})`);
      }
      return { type: StateValueType.Number, value: n };
    }
    case StateValueType.Bool: {
      const lower = raw.toLowerCase();
      if (lower !== 'true' && lower !== 'false') {
        throw new Error(`--type bool requires --value true|false (got ${raw})`);
      }
      return { type: StateValueType.Bool, value: lower === 'true' };
    }
    case StateValueType.Enum:
      return { type: StateValueType.Enum, value: raw };
    default:
      throw new Error(`unknown --type ${type} (expected string|number|bool|enum)`);
  }
}

/** Pretty-print a value as JSON. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
