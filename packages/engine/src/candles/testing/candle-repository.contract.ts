import { type Candle, type CandleRepository, Period, SymbolType } from '@lametrader/core';
import { expect, it } from 'vitest';

/** The symbol+period the contract probes. */
const ID = 'crypto:BTCUSDT';
const PERIOD = Period.OneHour;

/** Build a crypto candle at `time` with `close` (to detect replacement). */
const candle = (time: number, close = 1.5): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close,
  volume: 10,
  quoteVolume: 15,
  trades: 3,
});

/**
 * The shared behavioural contract every {@link CandleRepository} must satisfy.
 * Run against the in-memory adapter in the unit tier and the Mongo adapter in
 * the e2e tier.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runCandleRepositoryContract(
  make: () => CandleRepository | Promise<CandleRepository>,
): void {
  it('range returns saved candles ascending by time', async () => {
    const repo = await make();
    await repo.save(ID, PERIOD, [candle(3000), candle(1000), candle(2000)]);

    expect(await repo.range(ID, PERIOD, 0, 4000)).toEqual([
      candle(1000),
      candle(2000),
      candle(3000),
    ]);
  });

  it('save is idempotent: re-saving a time replaces it (no duplicate)', async () => {
    const repo = await make();
    await repo.save(ID, PERIOD, [candle(1000, 1.5)]);
    await repo.save(ID, PERIOD, [candle(1000, 9.9)]);

    expect(await repo.range(ID, PERIOD, 0, 4000)).toEqual([candle(1000, 9.9)]);
  });

  it('range with a limit returns at most that many candles, lowest-time first', async () => {
    const repo = await make();
    await repo.save(ID, PERIOD, [candle(3000), candle(1000), candle(2000)]);

    expect(await repo.range(ID, PERIOD, 0, 4000, 2)).toEqual([candle(1000), candle(2000)]);
  });

  it('latest returns the highest-time candle, and null when empty', async () => {
    const repo = await make();
    expect(await repo.latest(ID, PERIOD)).toBeNull();

    await repo.save(ID, PERIOD, [candle(1000), candle(3000), candle(2000)]);
    expect(await repo.latest(ID, PERIOD)).toEqual(candle(3000));
  });

  it('latestN returns the most recent n candles highest-time first, capped at how many exist', async () => {
    const repo = await make();
    expect(await repo.latestN(ID, PERIOD, 2)).toEqual([]);

    await repo.save(ID, PERIOD, [candle(1000), candle(3000), candle(2000)]);

    // Asks for 2 of 3 — newest first.
    expect(await repo.latestN(ID, PERIOD, 2)).toEqual([candle(3000), candle(2000)]);
    // Asks for more than exist — returns all it has, newest first.
    expect(await repo.latestN(ID, PERIOD, 5)).toEqual([candle(3000), candle(2000), candle(1000)]);
  });

  it('deleteSymbol removes the symbol candles (all periods), leaving others intact', async () => {
    const repo = await make();
    await repo.save(ID, Period.OneHour, [candle(1000)]);
    await repo.save(ID, Period.OneDay, [candle(2000)]);
    await repo.save('crypto:ETHUSDT', Period.OneHour, [candle(3000)]);

    await repo.deleteSymbol(ID);

    expect(await repo.range(ID, Period.OneHour, 0, 4000)).toEqual([]);
    expect(await repo.latest(ID, Period.OneDay)).toBeNull();
    expect(await repo.range('crypto:ETHUSDT', Period.OneHour, 0, 4000)).toEqual([candle(3000)]);
  });
}
