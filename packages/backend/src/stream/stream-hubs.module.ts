import type { IndicatorStateEvent, RuleEventEntry, SymbolQuoteEvent } from '@lametrader/core';
import { Logger, Module } from '@nestjs/common';
import { StreamHub } from '../common/services/stream-hub.js';
import type { CandleEvent } from '../market/interfaces/polling.service.types.js';
import {
  CANDLE_STREAM,
  INDICATOR_STREAM,
  QUOTE_STREAM,
  RULE_EVENT_STREAM,
} from './stream.tokens.js';

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
 * The four live-stream hubs, as a dependency-free provider module.
 *
 * Holds one instance of the single shared {@link StreamHub} per stream kind
 * (candle / indicator / quote / rule-event) and exports all four tokens. It
 * imports nothing, so the producer modules that publish to a hub
 * ({@link import('../candles/candles.module.js').CandlesModule},
 * {@link import('../indicators/indicators.module.js').IndicatorsModule}) and the
 * {@link import('./stream.module.js').StreamModule} that hosts the gateway which
 * subscribes to them can all import it and resolve the **same** singletons with
 * no module cycle — the seam that keeps the producer→hub topology acyclic.
 *
 * Nest instantiates a statically-imported module once, so every importer shares
 * one hub per kind: the producer publishes and the gateway subscribes over the
 * identical instance.
 */
@Module({
  providers: [
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
  ],
  exports: [CANDLE_STREAM, INDICATOR_STREAM, QUOTE_STREAM, RULE_EVENT_STREAM],
})
export class StreamHubsModule {}
