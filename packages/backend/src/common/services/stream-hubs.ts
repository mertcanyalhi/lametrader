import type {
  CandleEvent,
  IndicatorStateEvent,
  RuleEventEntry,
  SymbolQuoteEvent,
} from '@lametrader/core';
import { Logger, type Provider } from '@nestjs/common';
import {
  CANDLE_STREAM,
  INDICATOR_STREAM,
  QUOTE_STREAM,
  RULE_EVENT_STREAM,
} from '../interfaces/stream.tokens.js';
import { StreamHub } from './stream-hub.js';

/** Scoped logger for hub fan-out failures. */
const logger = new Logger('StreamHub');

/**
 * Build a {@link StreamHub} `onError` sink that reports a subscriber throw
 * (typically a send racing a socket close) through the scoped logger instead of
 * letting it vanish — the throw stays isolated (other subscribers still run),
 * mirroring the old `api/main.ts` `onSubscriberError`.
 */
function onSubscriberError(scope: string): (error: unknown, key: string) => void {
  return (error, key) =>
    logger.error(
      `stream subscriber threw during ${scope} fan-out (key: ${key})`,
      error instanceof Error ? error.stack : String(error),
    );
}

/**
 * The four live-stream hubs, as infra providers hosted by {@link CommonModule}.
 *
 * Holds one instance of the single shared {@link StreamHub} per stream kind
 * (candle / indicator / quote / rule-event). They sit in the {@link CommonModule}
 * leaf — below every feature context — so the producers that publish to a hub
 * (the market poll loop, the analytics indicator service) and the delivery
 * `/stream` gateway that subscribes all resolve the **same** singletons with no
 * module cycle; the event contracts they carry live in `@lametrader/core`, so
 * the hubs depend on no feature context.
 */
export const streamHubProviders: Provider[] = [
  {
    provide: CANDLE_STREAM,
    useFactory: () => new StreamHub<CandleEvent>(onSubscriberError('candle')),
  },
  {
    provide: INDICATOR_STREAM,
    useFactory: () => new StreamHub<IndicatorStateEvent>(onSubscriberError('indicator')),
  },
  {
    provide: QUOTE_STREAM,
    useFactory: () => new StreamHub<SymbolQuoteEvent>(onSubscriberError('quote')),
  },
  {
    provide: RULE_EVENT_STREAM,
    useFactory: () => new StreamHub<RuleEventEntry>(onSubscriberError('rule-event')),
  },
];
