/**
 * Entry point: wire Mongo-backed config + symbol services, start the continuous
 * polling + live-candle stream, and serve the REST API.
 */
import type { IndicatorStateEvent, RuleEventEntry, SymbolQuoteEvent } from '@lametrader/core';
import { type CandleEvent, connectServices, loadSettings } from '@lametrader/engine';
import { createApp } from './app.js';
import { StreamHub } from './stream-hub.js';

const {
  mongoUri,
  apiPort,
  pollIntervals,
  telegramDestinations: telegramDestinationsSeed,
} = loadSettings();

// Hubs bridge the engine's transport-agnostic `onCandle` / `onIndicatorState` /
// `onSymbolQuote` / `onRuleEvent` callbacks to the `/stream` WebSocket route
// (see ADR-0005).
// A subscriber that throws (a send racing socket close) is logged, not swallowed;
// `app` is referenced lazily — fan-out only runs once polling starts, well after it's assigned.
const onSubscriberError = (scope: string) => (error: unknown, key: string) =>
  app.log.error({ err: error, scope, key }, 'stream subscriber threw during fan-out');
const candleStream = new StreamHub<CandleEvent>(onSubscriberError('candle'));
const indicatorStream = new StreamHub<IndicatorStateEvent>(onSubscriberError('indicator'));
const quoteStream = new StreamHub<SymbolQuoteEvent>(onSubscriberError('quote'));
const ruleEventStream = new StreamHub<RuleEventEntry>(onSubscriberError('rule-event'));

const {
  config,
  symbols,
  profiles,
  rules,
  backfill,
  polling,
  indicators,
  indicatorService,
  quoteStream: quoteStreamService,
  state,
  stateHistory,
  telegramDestinations,
  close,
} = await connectServices(mongoUri, {
  onCandle: (event) => candleStream.publish(event.id, event),
  onIndicatorState: (event) => indicatorStream.publish(event.subscriptionId, event),
  onSymbolQuote: (event) => quoteStream.publish(event.subscriptionId, event),
  // Only the symbol-side mirror feeds the chart's live stream — the rule-side
  // mirror reaches no chart consumer today.
  onRuleEvent: (entry, target) => {
    if (target.kind === 'symbol') ruleEventStream.publish(target.symbolId, entry);
  },
  pollIntervals,
  seedTelegramDestinations: telegramDestinationsSeed,
});

const app = createApp(
  {
    config,
    symbols,
    profiles,
    rules,
    state,
    stateHistory,
    telegramDestinations,
    backfill,
    indicators: { registry: indicators, compute: indicatorService },
    liveStream: {
      candleStream,
      indicatorStream,
      indicatorService,
      quoteStream,
      quoteStreamService,
      ruleEventStream,
    },
  },
  { logger: true },
);

/**
 * Stop polling, close the HTTP server and database connection on a termination signal.
 */
const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  polling.stop();
  await app.close();
  await close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: apiPort, host: '0.0.0.0' });
polling.start();
