import { Redis } from 'ioredis';
import { RedisOncePerBarLatchStore } from '../src/analytics/rules/dispatch/redis-once-per-bar-latch.store.js';
import { runOncePerBarLatchStoreContract } from '../src/analytics/rules/testing/once-per-bar-latch.contract.js';

/**
 * Runs the shared {@link import('../src/analytics/rules/dispatch/once-per-bar-latch.types.js').OncePerBarLatchStore}
 * contract against the Redis adapter over a real Redis (Testcontainers) — the
 * e2e half of the suite whose unit half runs against the in-memory fake.
 * Together they prove the Redis adapter is behaviour-identical to the fake
 * (issue #513, ADR-0020).
 *
 * `REDIS_URL` is published by `test/global-setup.ts` (the one shared container).
 * The e2e tier runs `--runInBand`, so flushing the db between contract cases
 * never races another suite.
 */
describe('RedisOncePerBarLatchStore (contract, e2e)', () => {
  let redis: Redis;
  let store: RedisOncePerBarLatchStore;

  beforeAll(() => {
    const url = process.env.REDIS_URL;
    if (url === undefined) throw new Error('REDIS_URL must be set by test/global-setup.ts');
    redis = new Redis(url);
    store = new RedisOncePerBarLatchStore(redis);
  }, 120_000);

  afterAll(async () => {
    await redis.quit();
  });

  // Each contract case gets a freshly-emptied keyspace.
  runOncePerBarLatchStoreContract(async () => {
    await redis.flushdb();
    return store;
  });
});
