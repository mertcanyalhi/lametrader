/**
 * Entry point: wire Mongo-backed config + symbol services, start the continuous
 * polling + live-candle stream, and serve the REST API.
 */
import type { IndicatorStateEvent, SymbolQuoteEvent } from '@lametrader/core';
import { type CandleEvent, connectServices, loadSettings } from '@lametrader/engine';
import { createApp } from './app.js';
import { StreamHub } from './stream-hub.js';

const { mongoUri, apiPort, pollIntervals } = loadSettings();

// Hubs bridge the engine's transport-agnostic `onCandle` / `onIndicatorState` /
// `onSymbolQuote` callbacks to the `/stream` WebSocket route (see ADR-0005).
const candleStream = new StreamHub<CandleEvent>();
const indicatorStream = new StreamHub<IndicatorStateEvent>();
const quoteStream = new StreamHub<SymbolQuoteEvent>();

const {
  config,
  symbols,
  profiles,
  backfill,
  polling,
  indicators,
  indicatorCompute,
  indicatorStream: indicatorStreamService,
  quoteStream: quoteStreamService,
  close,
} = await connectServices(mongoUri, {
  onCandle: (event) => candleStream.publish(event.id, event),
  onIndicatorState: (event) => indicatorStream.publish(event.subscriptionId, event),
  onSymbolQuote: (event) => quoteStream.publish(event.subscriptionId, event),
  pollIntervals,
});

const app = createApp(
  {
    config,
    symbols,
    profiles,
    backfill,
    indicators: { registry: indicators, compute: indicatorCompute },
    liveStream: {
      candleStream,
      indicatorStream,
      indicatorStreamService,
      quoteStream,
      quoteStreamService,
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
