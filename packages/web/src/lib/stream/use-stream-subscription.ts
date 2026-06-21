import { useEffect, useRef } from 'react';
import { streamClient } from './stream-client.js';
import type { StreamEventMap, StreamKind, StreamSubscribeKey } from './stream-client.types.js';

/**
 * Subscribe to live frames for one {@link StreamKind} for the lifetime of the
 * component, over the shared {@link streamClient}. Re-subscribes when `kind` or
 * the registry key change, and tears down on unmount.
 *
 * The latest `onEvent` is held in a ref so a changing callback identity doesn't
 * churn the subscription. Passing `key: null` subscribes to nothing (e.g. before
 * an id is resolved).
 *
 * `key` is a plain `id` string for candle / quote subscriptions, and the
 * structured `{ id, period, indicator: { key, inputs } }` payload for
 * {@link StreamKind.Indicator}. Object identity does not matter — the underlying
 * `streamClient` dedupes by value, so a fresh object literal per render still
 * shares one upstream subscription.
 *
 * @param kind - which stream to subscribe to.
 * @param key - the registry key, or `null` to subscribe to nothing.
 * @param onEvent - called with each frame for the subscription.
 * @param keyDeps - dependency tuple that varies when `key`'s identity is unstable
 *   (e.g. a fresh `{ id, period, indicator }` object per render); the effect
 *   re-subscribes when any element changes. Defaults to a value-stable key (the
 *   string itself, or its JSON for object keys) so an object key passed without
 *   explicit deps still can't churn the subscription every render.
 */
export function useStreamSubscription<K extends StreamKind>(
  kind: K,
  key: StreamSubscribeKey<K> | null,
  onEvent: (event: StreamEventMap[K]) => void,
  keyDeps: ReadonlyArray<unknown> = [typeof key === 'string' ? key : JSON.stringify(key)],
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  // biome-ignore lint/correctness/useExhaustiveDependencies: caller-supplied keyDeps drive re-subscription; `key`'s object identity intentionally doesn't.
  useEffect(() => {
    if (!key) return;
    return streamClient.subscribe(kind, key, (event) => handler.current(event));
  }, [kind, ...keyDeps]);
}
