import { type Candle, Period, type StateValue, StateValueType, SymbolType } from '@lametrader/core';

import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { FallbackSeriesView, FormingBarSeriesView, PagedBarSeriesView } from './bar-series-view.js';
import { ArraySeriesView } from './indicator-series-store.js';
import type { SeriesPoint } from './series.types.js';

const SYMBOL = 'BTC';
const PERIOD = Period.OneMinute;

const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close - 0.5,
  high: close + 1,
  low: close - 1,
  close,
  volume: close * 10,
  quoteVolume: close * 100,
  trades: 1,
});

/**
 * An in-memory repository that records every `latestN` call so a test can
 * assert exactly how many pages the pager fetched and with which `before`
 * cursor — the whole point of the lazy pager is that an early-stopping walk
 * touches the store once.
 */
class CountingCandleRepository extends InMemoryCandleRepository {
  /** One entry per `latestN` invocation, in call order. */
  readonly latestNCalls: Array<{ n: number; before: number | undefined }> = [];

  override async latestN(
    symbolId: string,
    period: Period,
    n: number,
    before?: number,
  ): Promise<Candle[]> {
    this.latestNCalls.push({ n, before });
    return super.latestN(symbolId, period, n, before);
  }
}

/** Drain an async backward walk into an array for full-payload assertions. */
async function collect(iter: AsyncIterableIterator<SeriesPoint>): Promise<SeriesPoint[]> {
  const out: SeriesPoint[] = [];
  for await (const point of iter) out.push(point);
  return out;
}

const num = (value: number): StateValue => ({ type: StateValueType.Number, value });

describe('PagedBarSeriesView', () => {
  it('fetches exactly one page when the consumer stops within the first page (early-stop is one round-trip)', async () => {
    const repo = new CountingCandleRepository();
    await repo.save(SYMBOL, PERIOD, [
      candle(1000, 10),
      candle(2000, 20),
      candle(3000, 30),
      candle(4000, 40),
      candle(5000, 50),
    ]);
    const view = new PagedBarSeriesView(repo, SYMBOL, PERIOD, 'close', 6000, 2);

    const walker = view.backwardWalk();
    const first = await walker.next();
    const second = await walker.next();

    expect({
      first: first.value,
      second: second.value,
      latestNCalls: repo.latestNCalls,
    }).toEqual({
      first: { ts: 5000, value: num(50) },
      second: { ts: 4000, value: num(40) },
      // The second `next` returned the last point of page 1, so page 2 was
      // never requested — one fetch total.
      latestNCalls: [{ n: 2, before: 6000 }],
    });
  });

  it('pages backward on demand, each next page bounded by the oldest candle already seen, ending on the short final page', async () => {
    const repo = new CountingCandleRepository();
    await repo.save(SYMBOL, PERIOD, [
      candle(1000, 10),
      candle(2000, 20),
      candle(3000, 30),
      candle(4000, 40),
      candle(5000, 50),
    ]);
    const view = new PagedBarSeriesView(repo, SYMBOL, PERIOD, 'close', 6000, 2);

    const walked = await collect(view.backwardWalk());

    expect({ walked, latestNCalls: repo.latestNCalls }).toEqual({
      walked: [
        { ts: 5000, value: num(50) },
        { ts: 4000, value: num(40) },
        { ts: 3000, value: num(30) },
        { ts: 2000, value: num(20) },
        { ts: 1000, value: num(10) },
      ],
      latestNCalls: [
        { n: 2, before: 6000 },
        { n: 2, before: 4000 },
        // Page 3 returns a single candle (< page size), so the walk ends without
        // a further probe.
        { n: 2, before: 2000 },
      ],
    });
  });

  it('never reads a candle at or after the exclusive `before` bound, so a later-ts candle cannot become the newest point', async () => {
    const repo = new CountingCandleRepository();
    await repo.save(SYMBOL, PERIOD, [candle(3000, 30), candle(5000, 50), candle(7000, 70)]);
    const view = new PagedBarSeriesView(repo, SYMBOL, PERIOD, 'close', 6000, 64);

    const walked = await collect(view.backwardWalk());

    expect(walked).toEqual([
      { ts: 5000, value: num(50) },
      { ts: 3000, value: num(30) },
    ]);
  });

  it('asOf pages just far enough to find the latest point at or before queryTs', async () => {
    const repo = new CountingCandleRepository();
    await repo.save(SYMBOL, PERIOD, [candle(1000, 10), candle(2000, 20), candle(3000, 30)]);
    const view = new PagedBarSeriesView(repo, SYMBOL, PERIOD, 'close', 4000, 64);

    expect({
      hit: await view.asOf(2500),
      miss: await view.asOf(500),
    }).toEqual({
      hit: { ts: 2000, value: num(20) },
      miss: null,
    });
  });
});

describe('FallbackSeriesView', () => {
  it('yields the fallback view when the primary is empty', async () => {
    const primary = new PagedBarSeriesView(
      new InMemoryCandleRepository(),
      SYMBOL,
      PERIOD,
      'close',
      6000,
      64,
    );
    const fallback = new ArraySeriesView([{ ts: 0, value: num(42) }]);
    const view = new FallbackSeriesView(primary, fallback);

    expect({
      walked: await collect(view.backwardWalk()),
      asOf: await view.asOf(Number.MAX_SAFE_INTEGER),
    }).toEqual({
      walked: [{ ts: 0, value: num(42) }],
      asOf: { ts: 0, value: num(42) },
    });
  });

  it('ignores the fallback entirely when the primary has points — even for an asOf that finds no in-range point', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(SYMBOL, PERIOD, [candle(5000, 50)]);
    const primary = new PagedBarSeriesView(repo, SYMBOL, PERIOD, 'close', 6000, 64);
    const fallback = new ArraySeriesView([{ ts: 0, value: num(999) }]);
    const view = new FallbackSeriesView(primary, fallback);

    expect({
      walked: await collect(view.backwardWalk()),
      asOfHit: await view.asOf(Number.MAX_SAFE_INTEGER),
      // The primary has a point but none at or before 4000; a non-empty primary
      // never defers to the fallback, so this resolves to null (matching the
      // earlier "override the mirror outright when the repo has rows" merge).
      asOfMiss: await view.asOf(4000),
    }).toEqual({
      walked: [{ ts: 5000, value: num(50) }],
      asOfHit: { ts: 5000, value: num(50) },
      asOfMiss: null,
    });
  });
});

const HOUR = 3_600_000;
const MIN = 60_000;

describe('FormingBarSeriesView', () => {
  it('synthesizes the forming coarse bar from the fine candles in the current, not-yet-closed window', async () => {
    const repo = new InMemoryCandleRepository();
    // Three 1m candles inside hour 1 (window [HOUR, 2*HOUR)); no closed 1h bar yet for it.
    await repo.save(SYMBOL, Period.OneMinute, [
      candle(HOUR, 10),
      candle(HOUR + MIN, 20),
      candle(HOUR + 2 * MIN, 30),
    ]);
    const axes = ['open', 'high', 'low', 'close', 'volume'] as const;

    const forming = Object.fromEntries(
      await Promise.all(
        axes.map(async (axis) => [
          axis,
          await new FormingBarSeriesView(
            repo,
            SYMBOL,
            Period.OneHour,
            Period.OneMinute,
            axis,
            HOUR + 2 * MIN + 1,
          ).asOf(Number.MAX_SAFE_INTEGER),
        ]),
      ),
    );

    expect(forming).toEqual({
      open: { ts: HOUR, value: num(9.5) }, // oldest fine open (10 - 0.5)
      high: { ts: HOUR, value: num(31) }, // max fine high (30 + 1)
      low: { ts: HOUR, value: num(9) }, // min fine low (10 - 1)
      close: { ts: HOUR, value: num(30) }, // newest fine close
      volume: { ts: HOUR, value: num(600) }, // sum of fine volumes (10+20+30)*10
    });
  });

  it('layers the forming bar as the newest point on top of the closed coarse history behind it', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(SYMBOL, Period.OneHour, [candle(0, 5)]); // closed hour-0 bar
    await repo.save(SYMBOL, Period.OneMinute, [candle(HOUR, 10), candle(HOUR + MIN, 30)]);
    const view = new FormingBarSeriesView(
      repo,
      SYMBOL,
      Period.OneHour,
      Period.OneMinute,
      'close',
      HOUR + MIN + 1,
    );

    expect(await collect(view.backwardWalk())).toEqual([
      { ts: HOUR, value: num(30) }, // forming hour-1 bar, newest
      { ts: 0, value: num(5) }, // closed hour-0 bar behind it
    ]);
  });

  it('reads the last closed coarse bar when the current window has no fine candles yet', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(SYMBOL, Period.OneHour, [candle(0, 5)]); // only closed history exists
    const view = new FormingBarSeriesView(
      repo,
      SYMBOL,
      Period.OneHour,
      Period.OneMinute,
      'close',
      HOUR + MIN + 1,
    );

    expect({
      walked: await collect(view.backwardWalk()),
      asOf: await view.asOf(Number.MAX_SAFE_INTEGER),
    }).toEqual({
      walked: [{ ts: 0, value: num(5) }],
      asOf: { ts: 0, value: num(5) },
    });
  });

  it('resamples a past, already-closed window to its closed bar — never a partial roll-up — so asOf agrees with backwardWalk', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(SYMBOL, Period.OneHour, [candle(0, 5)]); // closed hour-0 bar
    await repo.save(SYMBOL, Period.OneMinute, [candle(HOUR, 100), candle(HOUR + MIN, 200)]); // forming hour 1
    const view = new FormingBarSeriesView(
      repo,
      SYMBOL,
      Period.OneHour,
      Period.OneMinute,
      'close',
      HOUR + MIN + 1,
    );

    // 30m sits in the closed hour-0 window; backwardWalk yields the hour-0 bar
    // (ts=0) at/below it, so asOf(30m) must return that same closed bar, not the
    // hour-1 forming roll-up and not null.
    expect(await view.asOf(30 * MIN)).toEqual({ ts: 0, value: num(5) });
  });
});
