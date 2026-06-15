import { IndicatorNotFoundError } from '@lametrader/core';
import type { IndicatorRegistry } from '@lametrader/engine';

/**
 * Run the `indicators` CLI command against an {@link IndicatorRegistry} and return the output to print.
 *
 * Subcommands:
 *
 * - `list` — every registered definition as JSON.
 * - `show <key>` — the matching definition as JSON; an unknown key throws `IndicatorNotFoundError`.
 *
 * @param argv - arguments after `indicators`.
 * @param registry - the indicator catalog to read from.
 */
export async function runIndicators(argv: string[], registry: IndicatorRegistry): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case 'list':
      return json(registry.list());
    case 'show': {
      const [key] = rest;
      if (!key) throw new Error('show requires a key');
      const module = registry.get(key);
      if (!module) {
        throw new IndicatorNotFoundError(`indicator not found: ${key}`);
      }
      return json(module.definition);
    }
    default:
      throw new Error(`unknown indicators subcommand: ${subcommand ?? '(none)'}`);
  }
}

/**
 * Pretty-print a value as JSON.
 */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
