import type { StartedMongoDBContainer } from '@testcontainers/mongodb';

/**
 * Jest `globalTeardown` for the e2e tier — stop the shared Mongo container that
 * {@link import('./global-setup.js')} started and stashed on `globalThis`.
 */
export default async function globalTeardown(): Promise<void> {
  const container = (
    globalThis as typeof globalThis & { __MONGO_CONTAINER__?: StartedMongoDBContainer }
  ).__MONGO_CONTAINER__;
  await container?.stop();
}
