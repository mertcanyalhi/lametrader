import { parseArgs } from 'node:util';
import type { StateRepository } from '@lametrader/core';
import type { SymbolService } from '@lametrader/engine';

/**
 * The recognized subcommands of the `state` CLI command.
 */
enum StateSubcommand {
  /** List a symbol's state map (`--symbol`) or the global state map (`--global`). */
  List = 'list',
}

/**
 * Run the `state` CLI command against a {@link SymbolService} (for the
 * symbol-scoped read, which validates the symbol is watched and routes
 * through the symbols use-case) and a {@link StateRepository} (for the
 * global-scope read).
 *
 * Subcommands:
 *
 * - `list --symbol <id>` — print the symbol's current state map as JSON;
 *   `SymbolNotFoundError` propagates to the entry point as a non-zero exit.
 * - `list --global` — print the global state map as JSON.
 *
 * Exactly one of `--symbol` / `--global` must be provided to `list`.
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
          symbol: { type: 'string' },
          global: { type: 'boolean' },
        },
      });
      if (values.symbol !== undefined && values.global) {
        throw new Error('state list: pass only one of --symbol or --global');
      }
      if (values.symbol !== undefined) {
        return json(await symbols.listSymbolState(values.symbol));
      }
      if (values.global) {
        return json(await state.listGlobalState());
      }
      throw new Error('state list requires --symbol <id> or --global');
    }
    default:
      throw new Error(`unknown state subcommand: ${subcommand ?? '(none)'}`);
  }
}

/** Pretty-print a value as JSON. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
