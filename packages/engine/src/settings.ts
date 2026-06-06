import type { Settings } from './settings.types.js';

/**
 * Default MongoDB connection string (local dev infra in `infra/docker-compose.yml`).
 */
const DEFAULT_MONGO_URI =
  'mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin';

/**
 * Default port the REST API listens on.
 */
const DEFAULT_API_PORT = 3000;

/**
 * Resolve {@link Settings} from environment variables, falling back to defaults.
 *
 * @param env - the environment to read (defaults to `process.env`; pass an
 *   object in tests).
 */
export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    mongoUri: env.MONGODB_URI ?? DEFAULT_MONGO_URI,
    apiPort: Number(env.PORT ?? DEFAULT_API_PORT),
  };
}
