import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { StartedTestContainer } from 'testcontainers';

/**
 * Jest `globalTeardown` for the e2e tier — stop the shared Mongo and Redis
 * containers that {@link import('./global-setup.js')} started and stashed on
 * `globalThis`.
 */
export default async function globalTeardown(): Promise<void> {
  const store = globalThis as typeof globalThis & {
    __MONGO_CONTAINER__?: StartedMongoDBContainer;
    __REDIS_CONTAINER__?: StartedTestContainer;
  };
  await store.__MONGO_CONTAINER__?.stop();
  await store.__REDIS_CONTAINER__?.stop();
}
