import type { SymbolQuoteEvent } from '@lametrader/core';
import { useState } from 'react';
import { StreamKind } from './stream-client.types.js';
import { useStreamSubscription } from './use-stream-subscription.js';

/** The live quote values a stream frame carries (no `period` — see `SymbolQuoteEvent`). */
export type LiveQuote = SymbolQuoteEvent['quote'];

/**
 * Subscribe to a symbol's live quote feed over the shared `/stream` client and
 * return the latest quote values, or `null` before the first frame. The latest
 * frame is stored with the id it arrived for, so changing `id` reads back `null`
 * until the new symbol's first frame (no stale price under the new id); the
 * subscription is torn down on unmount.
 *
 * @param id - canonical symbol id to stream quotes for.
 */
export function useQuoteStream(id: string): LiveQuote | null {
  const [latest, setLatest] = useState<{ id: string; quote: LiveQuote } | null>(null);

  useStreamSubscription(StreamKind.Quote, id, (event) => setLatest({ id, quote: event.quote }));

  return latest?.id === id ? latest.quote : null;
}
