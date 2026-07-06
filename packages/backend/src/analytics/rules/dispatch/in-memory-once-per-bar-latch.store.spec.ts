import { runOncePerBarLatchStoreContract } from '../testing/once-per-bar-latch.contract.js';
import { InMemoryOncePerBarLatchStore } from './in-memory-once-per-bar-latch.store.js';

/**
 * The in-memory fake half of the shared {@link OncePerBarLatchStore} contract;
 * the Redis-adapter half runs the same suite over a real Redis in
 * `test/once-per-bar-latch-store.contract.e2e-spec.ts`.
 */
describe('InMemoryOncePerBarLatchStore (contract)', () => {
  runOncePerBarLatchStoreContract(() => new InMemoryOncePerBarLatchStore());
});
