import { useEffect, useRef } from 'react';
import { streamClient } from './stream-client.js';
import type { StreamEventMap, StreamKind } from './stream-client.types.js';

/**
 * Subscribe to one symbol's live frames on a {@link StreamKind} for the lifetime
 * of the component, over the shared {@link streamClient}. Re-subscribes when
 * `kind`/`id` change and tears down on unmount.
 *
 * The latest `onEvent` is held in a ref so a changing callback identity doesn't
 * churn the subscription — only `kind`/`id` do. Passing `id: null` subscribes to
 * nothing (e.g. before an id is resolved).
 *
 * @param kind - which stream to subscribe to.
 * @param id - the symbol id, or `null` to subscribe to nothing.
 * @param onEvent - called with each frame for the subscription.
 */
export function useStreamSubscription<K extends StreamKind>(
  kind: K,
  id: string | null,
  onEvent: (event: StreamEventMap[K]) => void,
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!id) return;
    return streamClient.subscribe(kind, id, (event) => handler.current(event));
  }, [kind, id]);
}
