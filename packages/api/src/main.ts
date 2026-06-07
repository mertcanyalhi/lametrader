/**
 * Entry point: wire Mongo-backed config + symbol services and serve the REST API.
 */
import { connectServices, loadSettings } from '@lametrader/engine';
import { createApp } from './app.js';

const { mongoUri, apiPort } = loadSettings();
const { config, symbols, close } = await connectServices(mongoUri);
const app = createApp({ config, symbols }, { logger: true });

/**
 * Close the HTTP server and database connection on a termination signal.
 */
const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: apiPort, host: '0.0.0.0' });
