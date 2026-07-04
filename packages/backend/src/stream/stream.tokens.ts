/**
 * DI tokens for the four live-stream pub/sub hubs the multiplexed `/stream`
 * gateway fans out.
 *
 * Each binds one instance of the single shared
 * {@link import('../candles/stream-hub.js').StreamHub} (no duplicate
 * implementation). The hubs live in a dependency-free
 * {@link import('./stream-hubs.module.js').StreamHubsModule} so that both the
 * producers that publish to them (the `PollingService` in `CandlesModule`, the
 * `IndicatorService` in `IndicatorsModule`, and the `QuoteStreamService` +
 * rule-event bridge in `StreamModule`) and the gateway that subscribes to them
 * resolve the same singletons without a module cycle.
 *
 * `StreamHub<T>` is a generic class with no runtime value to inject by type, so
 * each hub rides its own string token.
 */

/** The live-candle hub — keyed by symbol id; fed by `PollingService.onCandle`. */
export const CANDLE_STREAM = 'CANDLE_STREAM';

/** The indicator-state hub — keyed by subscription id; fed by `IndicatorService.onState`. */
export const INDICATOR_STREAM = 'INDICATOR_STREAM';

/** The quote hub — keyed by subscription id; fed by `QuoteStreamService.onQuote`. */
export const QUOTE_STREAM = 'QUOTE_STREAM';

/** The rule-event hub — keyed by symbol id; fed by the event log's `onAppend` (symbol side). */
export const RULE_EVENT_STREAM = 'RULE_EVENT_STREAM';
