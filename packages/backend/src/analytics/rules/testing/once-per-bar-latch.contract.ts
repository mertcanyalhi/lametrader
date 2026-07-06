import { Period } from '@lametrader/core';
import type { OncePerBarLatchStore } from '../dispatch/once-per-bar-latch.types.js';

/**
 * A TTL comfortably longer than any single test — every contract case relies on
 * the explicit {@link OncePerBarLatchStore.rearm} to clear entries, never on TTL
 * expiry (a Redis background-thread, minutes-scale concern out of scope here).
 */
const TTL_MS = 120_000;

/**
 * The shared behavioural contract every {@link OncePerBarLatchStore} must
 * satisfy.
 *
 * Run against the in-memory fake in the unit tier and the Redis adapter over a
 * real Redis (Testcontainers) in the e2e tier — together they prove the Redis
 * adapter is behaviour-identical to the fake (issue #513, ADR-0020).
 *
 * Uses Jest's ambient globals (`it`, `expect`); the caller wraps the calls in a
 * `describe`. Lives under `testing/` so it is excluded from the `tsc` build,
 * exactly like the co-located `.spec.ts` suites.
 *
 * @param make - builds a fresh, empty store under test.
 */
export function runOncePerBarLatchStoreContract(
  make: () => OncePerBarLatchStore | Promise<OncePerBarLatchStore>,
): void {
  it('reports not-latched for a (rule, symbol, period) that was never latched', async () => {
    const store = await make();
    expect(await store.isLatched('r1', 'AAPL', Period.OneMinute)).toEqual(false);
  });

  it('reports latched after latch() on the same (rule, symbol, period)', async () => {
    const store = await make();
    await store.latch('r1', 'AAPL', Period.OneMinute, TTL_MS);
    expect(await store.isLatched('r1', 'AAPL', Period.OneMinute)).toEqual(true);
  });

  it('keeps the latch per-rule: latching r1 leaves r2 unlatched on the same symbol+period', async () => {
    const store = await make();
    await store.latch('r1', 'AAPL', Period.OneMinute, TTL_MS);
    expect(await store.isLatched('r2', 'AAPL', Period.OneMinute)).toEqual(false);
  });

  it('clears the latch on rearm() for the same (symbol, period)', async () => {
    const store = await make();
    await store.latch('r1', 'AAPL', Period.OneMinute, TTL_MS);
    await store.rearm('AAPL', Period.OneMinute);
    expect(await store.isLatched('r1', 'AAPL', Period.OneMinute)).toEqual(false);
  });

  it('leaves a different symbol latch intact on rearm() of the same period', async () => {
    const store = await make();
    await store.latch('r1', 'AAPL', Period.OneMinute, TTL_MS);
    await store.latch('r1', 'MSFT', Period.OneMinute, TTL_MS);
    await store.rearm('AAPL', Period.OneMinute);
    expect(await store.isLatched('r1', 'MSFT', Period.OneMinute)).toEqual(true);
  });

  it('leaves a different period latch intact on rearm() of the same symbol', async () => {
    const store = await make();
    await store.latch('r1', 'AAPL', Period.OneMinute, TTL_MS);
    await store.latch('r1', 'AAPL', Period.FiveMinutes, TTL_MS);
    await store.rearm('AAPL', Period.OneMinute);
    expect(await store.isLatched('r1', 'AAPL', Period.FiveMinutes)).toEqual(true);
  });
}
