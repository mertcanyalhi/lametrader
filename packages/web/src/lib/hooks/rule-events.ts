import type { RuleEventEntry } from '@lametrader/core';
import { useQueryClient } from '@tanstack/react-query';
import { StreamKind } from '../stream/stream-client.types.js';
import { useStreamSubscription } from '../stream/use-stream-subscription.js';
import { symbolRuleEventsKey } from './rules.js';

/**
 * Cap on the markers query cache after a streamed prepend.
 * Matches the page size the chart's REST query fetches; capping keeps memory
 * bounded across a long-running session.
 */
export const MARKER_PAGE_SIZE = 200;

/**
 * Subscribe to a symbol's live rule-event feed over the shared `/stream`
 * client and fold each new {@link RuleEventEntry} into the React-Query cache
 * so the chart's markers and the events dialog see it immediately.
 *
 * Two caches are touched per frame:
 *
 * - The markers query (`[...symbolRuleEventsKey(id), 'markers']`) is mutated
 *   in place — the new entry is prepended and the array trimmed to
 *   {@link MARKER_PAGE_SIZE}. If the cache hasn't loaded yet, the mutation is
 *   a no-op (the initial REST fetch will include the entry).
 * - The events-dialog infinite query (`[...symbolRuleEventsKey(id), 'infinite']`)
 *   is invalidated so an open dialog refetches its newest page. Cheaper than
 *   re-implementing the dialog over a stream-driven cache for now.
 *
 * @param symbolId - canonical symbol id to stream rule events for.
 */
export function useRuleEventStream(symbolId: string): void {
  const queryClient = useQueryClient();
  useStreamSubscription(StreamKind.RuleEvent, symbolId, (entry) => {
    queryClient.setQueryData<RuleEventEntry[]>(
      [...symbolRuleEventsKey(symbolId), 'markers'],
      (prev) => (prev ? [entry, ...prev].slice(0, MARKER_PAGE_SIZE) : prev),
    );
    queryClient.invalidateQueries({
      queryKey: [...symbolRuleEventsKey(symbolId), 'infinite'],
    });
  });
}
