import { Period, SymbolType, type WatchedSymbol, type WatchlistRepository } from '@lametrader/core';

/** A watched crypto symbol carrying a `currency` (the Binance shape). */
const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin / TetherUS',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour, Period.OneDay],
};

/** A watched FX symbol with no `currency` (exercises the optional-field round-trip). */
const EURUSD: WatchedSymbol = {
  id: 'fx:EURUSD',
  type: SymbolType.Fx,
  description: 'Euro / US Dollar',
  exchange: 'OANDA',
  periods: [Period.OneHour],
};

/** Sort by id so list assertions are order-independent across adapters. */
const byId = (a: WatchedSymbol, b: WatchedSymbol): number => a.id.localeCompare(b.id);

/**
 * The shared behavioural contract every {@link WatchlistRepository} must satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongoose adapter in
 * the e2e (Testcontainers) tier. Together they prove the Mongoose rewrite is
 * behaviour-identical to the old native-driver repository.
 *
 * Uses Jest's ambient globals (`it`, `expect`); the caller wraps the calls in a
 * `describe`. This file lives under `testing/` and is excluded from the `tsc`
 * build, exactly like the co-located `.spec.ts` suites.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runWatchlistRepositoryContract(
  make: () => WatchlistRepository | Promise<WatchlistRepository>,
): void {
  it('add then get round-trips a symbol carrying a currency', async () => {
    const repo = await make();
    await repo.add(BTC);
    expect(await repo.get(BTC.id)).toEqual(BTC);
  });

  it('add then get round-trips a symbol with no currency (optional field omitted)', async () => {
    const repo = await make();
    await repo.add(EURUSD);
    expect(await repo.get(EURUSD.id)).toEqual(EURUSD);
  });

  it('list returns all watched symbols', async () => {
    const repo = await make();
    await repo.add(BTC);
    await repo.add(EURUSD);
    expect((await repo.list()).sort(byId)).toEqual([BTC, EURUSD].sort(byId));
  });

  it('add replaces by id (no duplicate)', async () => {
    const repo = await make();
    await repo.add(BTC);
    await repo.add({ ...BTC, periods: [Period.FourHours] });
    expect(await repo.list()).toEqual([{ ...BTC, periods: [Period.FourHours] }]);
  });

  it('get returns null for an unwatched id', async () => {
    const repo = await make();
    expect(await repo.get('crypto:NOPE')).toBeNull();
  });

  it('remove deletes, and is a no-op for an unwatched id', async () => {
    const repo = await make();
    await repo.add(BTC);
    await repo.remove(BTC.id);
    await repo.remove(BTC.id);
    expect(await repo.get(BTC.id)).toBeNull();
  });
}
