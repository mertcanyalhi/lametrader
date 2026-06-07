import type { MarketDataSource } from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * Inputs the contract needs to probe a concrete {@link MarketDataSource}: a query
 * expected to return results, an id known to exist, and one known to be bogus
 * (both of a type the source serves).
 */
export interface MarketDataSourceContractCase {
  /** A query expected to return at least one result. */
  query: string;
  /** A canonical id that exists at the source. */
  knownId: string;
  /** A canonical id (of a served type) that does not exist. */
  bogusId: string;
}

/**
 * The shared behavioural contract every {@link MarketDataSource} must satisfy.
 * Run against the in-memory adapter in the unit tier and the real Binance/Yahoo
 * adapters in the live tier. Assertions are structural (live data is not fixed).
 *
 * @param make - builds the source under test.
 * @param testCase - probe inputs for the concrete source.
 */
export function runMarketDataSourceContract(
  make: () => MarketDataSource | Promise<MarketDataSource>,
  testCase: MarketDataSourceContractCase,
): void {
  it('search returns only symbols of the source’s types', async () => {
    const source = await make();
    const results = await source.search(testCase.query);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((symbol) => source.types.includes(symbol.type))).toBe(true);
  });

  it('lookup resolves an existing id (with an exchange) and returns null for a bogus one', async () => {
    const source = await make();
    const found = await source.lookup(testCase.knownId);
    expect(found?.id).toBe(testCase.knownId);
    expect(found?.exchange).toBeTruthy();
    expect(await source.lookup(testCase.bogusId)).toBeNull();
  });
}
