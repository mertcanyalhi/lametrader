import mongoose from 'mongoose';

/**
 * `setupFilesAfterEnv` hook for the e2e tier — give every spec file a clean
 * database.
 *
 * All e2e specs boot their own Nest app against the one shared Mongo started in
 * {@link import('./global-setup.js')}, so without this they would accumulate
 * each other's documents and break the full-payload assertions. Dropping the
 * database before each file's suites run restores the fresh-database guarantee
 * the per-container harness used to give. The e2e tier runs in-band
 * (`--runInBand`), so files execute one at a time and this reset never races a
 * sibling file's tests.
 *
 * Registered from `setupFilesAfterEnv`, this top-level `beforeAll` runs before
 * any spec's own `beforeAll`, so the drop always precedes the app boot.
 */
beforeAll(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set — the e2e globalSetup did not run.');
  }
  const connection = await mongoose.createConnection(uri).asPromise();
  await connection.dropDatabase();
  await connection.close();
});
