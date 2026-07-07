import {
  type Candle,
  type IndicatorStatePoint,
  Period,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { movingAverage } from '../indicators/sma.js';
import { volumeWeightedMovingAverage } from '../indicators/vwma.js';
import { PagedIndicatorSeriesView } from './indicator-series-view.js';
import type { SeriesPoint } from './series.types.js';

const SYMBOL = 'BTC';
const PERIOD = Period.OneMinute;
const NO_UPPER_BOUND = Number.MAX_SAFE_INTEGER;

/** Build a uniform crypto candle at `time` closing at `close`. */
const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  quoteVolume: close,
  trades: 1,
});

/** Drain an async backward walk into an array for full-payload assertions. */
async function collect<T>(iter: AsyncIterableIterator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

/**
 * Project a `stateKey` out of an eager `compute` state series into ascending
 * {@link SeriesPoint}s, dropping warm-up / non-numeric rows — the reference
 * projection the lazy view must reproduce, newest-first.
 */
function projectEager(state: IndicatorStatePoint[], stateKey: string): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const row of state) {
    const raw = row[stateKey];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      out.push({ ts: row.time, value: { type: StateValueType.Number, value: raw } });
    }
  }
  return out;
}

/** Seed a candle repo + watchlist + indicator service with the two reference indicators. */
const setup = async (
  symbolType: SymbolType,
  closes: number[],
): Promise<{ repo: InMemoryCandleRepository; service: IndicatorService }> => {
  const repo = new InMemoryCandleRepository();
  const bars = closes.map((c, i) => candle((i + 1) * 60_000, c));
  await repo.save(SYMBOL, PERIOD, bars);

  const watchlist = new InMemoryWatchlistRepository([
    { id: SYMBOL, type: symbolType, description: SYMBOL, exchange: 'X', periods: [PERIOD] },
  ]);
  const indicators = new IndicatorRegistry();
  indicators.register(movingAverage);
  indicators.register(volumeWeightedMovingAverage);
  const service = new IndicatorService(indicators, watchlist, repo);
  return { repo, service };
};

describe('PagedIndicatorSeriesView', () => {
  it('walks the same points (newest-first) as an eager full-series compute over the same bars', async () => {
    const { repo, service } = await setup(SymbolType.Crypto, [10, 20, 30, 40, 50]);
    const eager = await service.compute(SYMBOL, 'sma', { length: 3, source: 'close' }, PERIOD);
    const expected = projectEager(eager.state, 'value').reverse();

    const view = new PagedIndicatorSeriesView(
      repo,
      service,
      SYMBOL,
      PERIOD,
      'sma',
      { length: 3, source: 'close' },
      'value',
      NO_UPPER_BOUND,
    );

    expect(await collect(view.backwardWalk())).toEqual(expected);
  });

  it('asOf returns the latest point at or before the query time and null when none qualify', async () => {
    const { repo, service } = await setup(SymbolType.Crypto, [10, 20, 30]);
    const view = new PagedIndicatorSeriesView(
      repo,
      service,
      SYMBOL,
      PERIOD,
      'sma',
      { length: 1, source: 'close' },
      'value',
      NO_UPPER_BOUND,
    );

    expect({
      asOfMid: await view.asOf(150_000),
      asOfBeforeAll: await view.asOf(50_000),
    }).toEqual({
      // SMA(1) is the close itself; latest point at or before 150s is the 120s bar (20).
      asOfMid: { ts: 120_000, value: { type: StateValueType.Number, value: 20 } },
      asOfBeforeAll: null,
    });
  });

  it('excludes a candle stored at or after the exclusive before bound from the walk', async () => {
    // A later bar (240s, close 999) sits past the bound and must not sway the newest point.
    const { repo, service } = await setup(SymbolType.Crypto, [10, 20, 30, 999]);
    const view = new PagedIndicatorSeriesView(
      repo,
      service,
      SYMBOL,
      PERIOD,
      'sma',
      { length: 3, source: 'close' },
      'value',
      240_000,
    );

    // Only bars with time < 240_000 are read — SMA(3) at 180s is mean(10,20,30) = 20,
    // with no point at 240s (excluded), so 999 never enters the average.
    expect(await collect(view.backwardWalk())).toEqual([
      { ts: 180_000, value: { type: StateValueType.Number, value: 20 } },
    ]);
  });

  it('computes one bounded page per candle page, not one recompute per point', async () => {
    const { repo, service } = await setup(SymbolType.Crypto, [10, 20, 30, 40, 50]);
    const computeSpy = jest.spyOn(service, 'compute');

    const view = new PagedIndicatorSeriesView(
      repo,
      service,
      SYMBOL,
      PERIOD,
      'sma',
      { length: 1, source: 'close' },
      'value',
      NO_UPPER_BOUND,
      undefined, // no per-observation compute cache
      2, // page size
    );
    const walked = await collect(view.backwardWalk());

    expect({ walked, computeCalls: computeSpy.mock.calls.length }).toEqual({
      // SMA(1) = the close itself, newest-first.
      walked: [
        { ts: 300_000, value: { type: StateValueType.Number, value: 50 } },
        { ts: 240_000, value: { type: StateValueType.Number, value: 40 } },
        { ts: 180_000, value: { type: StateValueType.Number, value: 30 } },
        { ts: 120_000, value: { type: StateValueType.Number, value: 20 } },
        { ts: 60_000, value: { type: StateValueType.Number, value: 10 } },
      ],
      // 5 points at page size 2 → ceil(5 / 2) = 3 compute calls, not 5.
      computeCalls: 3,
    });
  });

  it('ends the walk with no points when the compute fails for the symbol asset class', async () => {
    // vwma consumes volume, so it excludes Fx — compute throws IndicatorError.
    const { repo, service } = await setup(SymbolType.Fx, [10, 20, 30]);
    const view = new PagedIndicatorSeriesView(
      repo,
      service,
      SYMBOL,
      PERIOD,
      'vwma',
      { length: 3 },
      'value',
      NO_UPPER_BOUND,
    );

    expect(await collect(view.backwardWalk())).toEqual([]);
  });
});
