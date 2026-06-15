/**
 * Entry point: wire Mongo-backed config + symbol services, start the continuous
 * polling + live-candle stream, and serve the REST API.
 */
import { connectServices, loadSettings } from '@lametrader/engine';
import { createApp } from './app.js';
import { CandleStreamHub } from './candle-stream-hub.js';

const { mongoUri, apiPort, pollIntervals } = loadSettings();

// The hub bridges the engine's transport-agnostic `onCandle` callback to the
// `/stream` WebSocket route (see ADR-0005).
const candleStream = new CandleStreamHub();
const { config, symbols, profiles, backfill, polling, indicators, indicatorCompute, close } =
  await connectServices(mongoUri, {
    onCandle: (event) => candleStream.publish(event),
    pollIntervals,
  });
const app = createApp(
  { config, symbols, profiles, backfill, candleStream, indicators, indicatorCompute },
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
