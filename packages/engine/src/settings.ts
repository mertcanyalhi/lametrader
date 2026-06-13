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
    apiPort: parsePort(env.PORT),
  };
}

/**
 * Parse the `PORT` env value into a positive integer, falling back to the default
 * when unset. Throws on a value that would otherwise become `NaN` (or a
 * non-positive / non-integer port), so a typo fails fast at startup rather than
 * silently listening on a bad port.
 */
function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_API_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer in 1..65535: ${value}`);
  }
  return port;
}
