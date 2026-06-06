/**
 * Runtime settings resolved from the environment, with sane defaults. The
 * `loadSettings` function in `settings.ts` is the single place that reads
 * `process.env`; modules take values from the result.
 */
export interface Settings {
  /**
   * MongoDB connection string (database taken from the URI).
   */
  mongoUri: string;
  /**
   * Port the REST API listens on.
   */
  apiPort: number;
}
