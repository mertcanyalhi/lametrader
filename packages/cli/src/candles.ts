import { parseArgs } from 'node:util';
import { type Period, parseBackfillRange, parseCandleLimit } from '@lametrader/core';
import type { BackfillService } from '@lametrader/engine';

/**
 * Run the `candles` CLI command against a {@link BackfillService} and return the
 * output to print.
 *
 * - `backfill <id> --period 1h [--from <ms> --to <ms>]` → backfill candles,
 *   streaming `progress: <saved>/<total>` lines to `log`, then echo the summary.
 * - `list <id> --period 1h [--from <ms> --to <ms>]` → stored candles as JSON.
 *
 * @param argv - arguments after `candles`.
 * @param service - the backfill use-case to drive.
 * @param log - sink for progress lines (defaults to `console.log`).
 */
export async function runCandles(
  argv: string[],
  service: BackfillService,
  log: (line: string) => void = console.log,
): Promise<string> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case 'backfill': {
      const { id, period, from, to } = parseCandleArgs(rest);
      const range = parseBackfillRange(
        from !== undefined || to !== undefined ? { from, to } : undefined,
      );
      const summary = await service.backfill(id, period, range, (progress) =>
        log(`progress: ${progress.saved}/${progress.total}`),
      );
      return json(summary);
    }
    case 'list': {
      const { id, period, from, to, limit } = parseCandleArgs(rest);
      const page = await service.read(id, period, {
        from: from ?? 0,
        to: to ?? Number.MAX_SAFE_INTEGER,
        limit: parseCandleLimit(limit),
      });
      return json(page);
    }
    default:
      throw new Error(`unknown candles subcommand: ${subcommand ?? '(none)'}`);
  }
}

/**
 * Parse the shared `<id> --period <p> [--from <ms> --to <ms>]` argument shape.
 */
function parseCandleArgs(args: string[]): {
  id: string;
  period: Period;
  from?: number;
  to?: number;
  limit?: number;
} {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      period: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      limit: { type: 'string' },
    },
  });
  const id = positionals[0];
  if (!id) throw new Error('candles requires an id');
  if (!values.period) throw new Error('candles requires --period');
  return {
    id,
    period: values.period as Period,
    from: values.from === undefined ? undefined : Number(values.from),
    to: values.to === undefined ? undefined : Number(values.to),
    limit: values.limit === undefined ? undefined : Number(values.limit),
  };
}

/**
 * Pretty-print a value as JSON.
 */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
