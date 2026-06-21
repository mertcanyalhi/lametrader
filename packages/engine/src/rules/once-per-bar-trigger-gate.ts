import { type Period, periodMillis, type RuleEventEntry, RuleEventType } from '@lametrader/core';

/**
 * The `OncePerBar` trigger gate.
 *
 * Returns `true` when no prior `Fired` event for `symbolId` lands in the same
 * `period` bar as `currentTs`.
 *
 * Pure read over `Rule.events[]` — the bar boundary is derived by aligning
 * `ts` to `periodMillis(period)`.
 */
export function mayFireOncePerBar(
  events: RuleEventEntry[],
  symbolId: string,
  currentTs: number,
  period: Period,
): boolean {
  const last = lastFiredAt(events, symbolId);
  if (last === null) return true;
  return barStart(last, period) !== barStart(currentTs, period);
}

/**
 * The `OncePerBarClose` trigger gate.
 *
 * Combines {@link mayFireOncePerBar} with a `final` check — a forming bar
 * never satisfies this trigger, regardless of prior fires.
 */
export function mayFireOncePerBarClose(
  events: RuleEventEntry[],
  symbolId: string,
  currentTs: number,
  period: Period,
  final: boolean,
): boolean {
  if (!final) return false;
  return mayFireOncePerBar(events, symbolId, currentTs, period);
}

/**
 * Latest `ts` of a `Fired` event for `symbolId`, or `null` if none.
 */
function lastFiredAt(events: RuleEventEntry[], symbolId: string): number | null {
  let latest: number | null = null;
  for (const event of events) {
    if (event.type === RuleEventType.Fired && event.symbolId === symbolId) {
      if (latest === null || event.ts > latest) latest = event.ts;
    }
  }
  return latest;
}

/**
 * Align an epoch-ms timestamp to the open of the bar it falls into.
 */
function barStart(ts: number, period: Period): number {
  const ms = periodMillis(period);
  return Math.floor(ts / ms) * ms;
}
