import { type RuleEventEntry, RuleEventType } from '@lametrader/core';

/**
 * The `OncePerMinute` trigger gate.
 *
 * Fires once when the rule's condition becomes true (false → true), then
 * stays silent while it remains true; re-arms when it flips false. A
 * `min-interval` guard suppresses additional fires within `intervalMs` of the
 * previous fire to absorb flapping.
 *
 * `prevActive` is whether the condition was true on the previous evaluation;
 * `nowActive` is whether it is true now. The orchestrator persists the
 * `currentlyActive` flag per (rule, symbol) and threads it into each call.
 */
export function mayFireOncePerMinute(
  events: RuleEventEntry[],
  symbolId: string,
  currentTs: number,
  intervalMs: number,
  prevActive: boolean,
  nowActive: boolean,
): boolean {
  if (!nowActive) return false;
  if (prevActive) return false;
  const last = lastFiredAt(events, symbolId);
  if (last !== null && currentTs - last < intervalMs) return false;
  return true;
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
