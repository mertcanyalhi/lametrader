/**
 * Entry point: wire a Mongo-backed config service and serve the REST API.
 */
import { connectConfigService, loadSettings } from '@lametrader/engine';
import { createApp } from './app.js';

const { mongoUri, apiPort } = loadSettings();
const { service, close } = await connectConfigService(mongoUri);
const app = createApp(service, { logger: true });

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
