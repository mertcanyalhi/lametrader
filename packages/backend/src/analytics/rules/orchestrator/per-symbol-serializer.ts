import { getLogger } from '../engine-log.js';

/**
 * Scope-bound logger for the per-symbol serializer, under `engine.rules.*`.
 */
const log = getLogger('engine.rules.serializer');

/**
 * An event with an optional `symbolId` — the discriminator the per-symbol
 * serializer keys on.
 *
 * `undefined` (or absent) `symbolId` means "no symbol" — those events all
 * share one global chain so e.g. Timer events still preserve arrival order
 * with each other.
 */
interface KeyedEvent {
  symbolId?: string;
}

/**
 * Serialize event processing **per `symbolId`** so events for one symbol
 * still preserve arrival order while events for different symbols run
 * concurrently. Events with no `symbolId` (Timer / GlobalStateChanged) share
 * a single "global" chain.
 *
 * Port of v1's `createPerSymbolSerializer` retyped to a generic event with
 * optional `symbolId`. Preserves #307's per-symbol parallelism.
 *
 * The returned `process` callback must handle its own errors; the serializer
 * additionally swallows any leftover rejection so the per-symbol chain stays
 * alive for subsequent events.
 *
 * @param process - the per-event work; must already catch and handle errors.
 * @returns `enqueue` (push an event onto its symbol's chain) and `drain`
 *   (await every chain — per-symbol and the global one — to settle).
 */
export function createPerSymbolSerializer<E extends KeyedEvent>(
  process: (event: E) => Promise<void>,
): {
  enqueue: (event: E) => void;
  drain: () => Promise<void>;
} {
  const chains = new Map<string | undefined, Promise<void>>();
  const enqueue = (event: E): void => {
    const key = event.symbolId;
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev
      .then(() => process(event))
      .catch((err) => {
        // `process` is contracted to handle its own errors, so reaching here is
        // unexpected — log it. Defense in depth: swallow it anyway to keep the
        // chain resolvable so the next event for `key` still runs.
        log.error(
          { err: { message: err instanceof Error ? err.message : String(err) }, symbolId: key },
          'per_symbol_process_unhandled',
        );
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
