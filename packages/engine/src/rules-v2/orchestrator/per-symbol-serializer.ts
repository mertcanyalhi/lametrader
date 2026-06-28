import type { RulesV2 } from '@lametrader/core';

/**
 * Serialize {@link RulesV2.EvaluationTriggerEvent} processing **per
 * `symbolId`** so events for one symbol still preserve arrival order while
 * events for different symbols run concurrently.
 *
 * Events whose variant carries no `symbolId` (Timer, GlobalStateChanged) share
 * a single "global" chain keyed on `null`. Ported from v1's serializer
 * (#307) and retyped to v2 events.
 *
 * The returned `process` callback is expected to handle its own errors; the
 * serializer additionally swallows any leftover rejection so the per-symbol
 * chain stays alive for subsequent events.
 *
 * @param process - the per-event work; must already catch and handle errors.
 * @returns `enqueue` (push an event onto its symbol's chain) and `drain`
 *   (await every chain — both per-symbol and the global one — to settle).
 */
export function createPerSymbolSerializer(
  process: (event: RulesV2.EvaluationTriggerEvent) => Promise<void>,
): {
  enqueue: (event: RulesV2.EvaluationTriggerEvent) => void;
  drain: () => Promise<void>;
} {
  const chains = new Map<string | null, Promise<void>>();
  const enqueue = (event: RulesV2.EvaluationTriggerEvent): void => {
    const key = chainKey(event);
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev
      .then(() => process(event))
      .catch(() => {
        // Defense in depth — keep the chain resolvable so the next event for
        // the same symbol still runs even if `process` somehow throws.
      });
    chains.set(key, next);
    void next.finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  };
  const drain = async (): Promise<void> => {
    while (chains.size > 0) {
      await Promise.all([...chains.values()]);
    }
  };
  return { enqueue, drain };
}

/**
 * Extract the per-chain key for `event`: `symbolId` for symbol-bearing events,
 * `null` for Timer / GlobalStateChanged.
 */
function chainKey(event: RulesV2.EvaluationTriggerEvent): string | null {
  return 'symbolId' in event ? event.symbolId : null;
}
