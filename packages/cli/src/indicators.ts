import { parseArgs } from 'node:util';
import { IndicatorNotFoundError, type Period } from '@lametrader/core';
import type { IndicatorRegistry, IndicatorService } from '@lametrader/engine';

/**
 * Run the `indicators` CLI command against the catalog registry (and optionally a compute service) and return the output to print.
 *
 * Subcommands:
 *
 * - `list` — every registered definition as JSON.
 * - `show <key>` — the matching definition as JSON; an unknown key throws `IndicatorNotFoundError`.
 * - `compute <symbolId> <indicatorKey> --period <p> [--from <ms>] [--to <ms>] [--inputs '<json>']` — print the computed series as JSON (requires the compute service).
 *
 * @param argv - arguments after `indicators`.
 * @param registry - the indicator catalog to read from.
 * @param compute - optional compute use-case; required by `compute` subcommand.
 */
export async function runIndicators(
  argv: string[],
  registry: IndicatorRegistry,
  compute?: IndicatorService,
): Promise<string> {
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
    case 'compute': {
      if (!compute) {
        throw new Error('compute requires the compute service to be wired');
      }
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          period: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          inputs: { type: 'string' },
        },
      });
      const symbolId = positionals[0];
      const indicatorKey = positionals[1];
      if (!symbolId || !indicatorKey) {
        throw new Error('compute requires <symbolId> <indicatorKey>');
      }
      if (!values.period) throw new Error('compute requires --period');
      const inputs: Record<string, unknown> = values.inputs ? JSON.parse(values.inputs) : {};
      const range: { from?: number; to?: number } = {};
      if (values.from !== undefined) range.from = Number(values.from);
      if (values.to !== undefined) range.to = Number(values.to);
      const result = await compute.compute(
        symbolId,
        indicatorKey,
        inputs,
        values.period as Period,
        range,
      );
      return json(result);
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
