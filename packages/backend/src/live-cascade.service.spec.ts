import type { CandleEvent } from '@lametrader/core';
import {
  type CryptoCandle,
  type IndicatorStateEvent,
  Period,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { defaultIndicators } from './analytics/indicators/default-indicators.js';
import { IndicatorService } from './analytics/indicators/indicator.service.js';
import { InMemoryStateRepository } from './analytics/persistence/in-memory-state.repository.js';
import { BarLifecycleBridge } from './analytics/rules/bridges/bar-lifecycle-bridge.js';
import { IndicatorCascadeBridge } from './analytics/rules/bridges/indicator-cascade-bridge.js';
import { InMemoryRuleRepository } from './analytics/rules/in-memory-rule.repository.js';
import { RuleEngineService } from './analytics/rules/rule-engine.service.js';
import { LiveEvaluationLookups } from './analytics/rules/wire/live-evaluation-lookups.js';
import type { WiredRuleEngine } from './analytics/rules/wire/wire-rule-engine.js';
import { InMemoryConfigRepository } from './common/persistence/in-memory-config.repository.js';
import { InMemoryEventLog } from './common/persistence/in-memory-event-log.js';
import { ConfigService } from './common/services/config.service.js';
import { InMemoryNotifier } from './common/services/in-memory-notifier.js';
import { QuoteStreamService } from './delivery/quote-stream.service.js';
import { LiveCascadeService } from './live-cascade.service.js';
import { InMemoryMarketDataSource } from './market/market-data/in-memory-market-data-source.js';
import { InMemoryCandleRepository } from './market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from './market/persistence/in-memory-watchlist.repository.js';
import { PollingService } from './market/services/polling.service.js';

/** A watched crypto symbol on the 1h period. */
const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
};

/** Build a crypto candle at `time` with a uniform OHLC around `close`. */
const candle = (time: number, close: number): CryptoCandle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  quoteVolume: close * 10,
  trades: 3,
});

/** One hour in ms — the polled (and default) period. */
const HOUR = 3_600_000;

/**
 * A fixed clock decades past every seeded candle, so each emitted bar is closed
 * (`final: true`) deterministically.
 */
const NOW = 1_000_000_000;

/** A full per-period interval record, every period at `ms`. */
const allIntervals = (ms: number): Record<Period, number> =>
  Object.fromEntries(Object.values(Period).map((p) => [p, ms])) as Record<Period, number>;

/**
 * Drain the microtask queue so the fire-and-forget `IndicatorService.handleCandle`
 * the cascade dispatches (un-awaited, exactly as the old `connectServices`
 * closure did) has fully recomputed before assertions. In-memory repos resolve
 * synchronously, so a bounded round of `Promise.resolve()` ticks fully settles
 * the chain; the loop lives here, not in a test body.
 */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

/**
 * Build the four real producers over in-memory fakes plus a
 * {@link LiveCascadeService} over them.
 *
 * The rule engine's `start()` is stubbed to return a wired engine whose two
 * bridges are real (spy-able) instances — the cascade's job is to *route* into
 * those bridges, not to compose the engine (that is `RuleEngineService`'s own
 * spec), so an observable stand-in keeps the wiring assertions precise.
 */
async function build() {
  const watchlist = new InMemoryWatchlistRepository([BTC]);
  const candles = new InMemoryCandleRepository();
  // A cursor exists so polling resumes; the source finalizes the last stored bar
  // (a partial close) and grows one bar past it, so both re-emit on the poll.
  await candles.save(BTC.id, Period.OneHour, [
    candle(0, 10),
    candle(HOUR, 20),
    candle(2 * HOUR, 25),
  ]);
  const source = new InMemoryMarketDataSource(
    [{ ...BTC }],
    [SymbolType.Crypto],
    [
      {
        id: BTC.id,
        period: Period.OneHour,
        candles: [candle(0, 10), candle(HOUR, 20), candle(2 * HOUR, 30), candle(3 * HOUR, 40)],
      },
    ],
  );
  const registry = defaultIndicators();
  const indicators = new IndicatorService(registry, watchlist, candles, { onState: () => {} });
  const config = new ConfigService(new InMemoryConfigRepository());
  const quotes = new QuoteStreamService(watchlist, config, candles, { onQuote: () => {} });
  const ruleEngine = new RuleEngineService(
    new InMemoryRuleRepository(),
    new InMemoryStateRepository(),
    watchlist,
    new InMemoryEventLog(),
    candles,
    new InMemoryNotifier(),
    indicators,
  );
  const barBridge = new BarLifecycleBridge(() => {});
  const indicatorBridge = new IndicatorCascadeBridge(() => {});
  const wired: WiredRuleEngine = {
    barBridge,
    indicatorBridge,
    lookups: new LiveEvaluationLookups(new InMemoryStateRepository()),
    drain: async () => {},
  };
  const startSpy = jest.spyOn(ruleEngine, 'start').mockResolvedValue(wired);
  const polling = new PollingService([source], candles, watchlist, new SchedulerRegistry(), {
    onCandle: () => {},
    intervals: allIntervals(10_000_000),
    now: () => NOW,
    random: () => 0,
  });
  const cascade = new LiveCascadeService(polling, indicators, quotes, ruleEngine);
  return { cascade, polling, indicators, quotes, ruleEngine, startSpy, barBridge, indicatorBridge };
}

describe('LiveCascadeService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('composes the rule engine and starts the poll loop on start()', async () => {
    const { cascade, polling, startSpy } = await build();
    const pollingStart = jest.spyOn(polling, 'start');

    await cascade.start();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(pollingStart).toHaveBeenCalledTimes(1);
    expect(cascade.isLive).toBe(true);
  });

  it('is dormant until start(): the constructor starts no poll loop', async () => {
    const { cascade, polling } = await build();
    const pollingStart = jest.spyOn(polling, 'start');

    expect(cascade.isLive).toBe(false);
    expect(pollingStart).not.toHaveBeenCalled();
  });

  it('fans a polled candle out to the indicator, quote, and rule-engine producers', async () => {
    const { cascade, polling, indicators, quotes, barBridge } = await build();
    const indicatorCalls: CandleEvent[] = [];
    const quoteCalls: CandleEvent[] = [];
    const barCalls: CandleEvent[] = [];
    jest.spyOn(indicators, 'handleCandle').mockImplementation(async (e) => {
      indicatorCalls.push(e);
    });
    jest.spyOn(quotes, 'handleCandle').mockImplementation((e) => {
      quoteCalls.push(e);
    });
    jest.spyOn(barBridge, 'handleCandle').mockImplementation((e) => {
      barCalls.push(e);
    });

    await cascade.start();
    await polling.poll();

    // The poll resumes from the 2*HOUR cursor and returns [2*HOUR, 3*HOUR]; every
    // producer receives both bars, each closed against the fixed clock.
    const expected: CandleEvent[] = [
      { id: BTC.id, period: Period.OneHour, candle: candle(2 * HOUR, 30), final: true },
      { id: BTC.id, period: Period.OneHour, candle: candle(3 * HOUR, 40), final: true },
    ];
    expect(indicatorCalls).toEqual(expected);
    expect(quoteCalls).toEqual(expected);
    expect(barCalls).toEqual(expected);
  });

  it('feeds a recomputed indicator state into the rule engine indicator bridge', async () => {
    const { cascade, polling, indicators, indicatorBridge } = await build();
    const bridgeEvents: IndicatorStateEvent[] = [];
    jest.spyOn(indicatorBridge, 'handleIndicatorState').mockImplementation((e) => {
      bridgeEvents.push(e);
    });
    const subscriptionId = await indicators.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });

    await cascade.start();
    await polling.poll();
    await flushMicrotasks();

    // SMA(3) over closes [10,20,30,40] yields 20 at 2*HOUR and 30 at 3*HOUR; each
    // recomputed state cascades into the rule engine's indicator bridge.
    expect(bridgeEvents).toEqual([
      {
        subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
        state: { time: 2 * HOUR, value: expect.closeTo(20, 6) },
        final: true,
      },
      {
        subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
        state: { time: 3 * HOUR, value: expect.closeTo(30, 6) },
        final: true,
      },
    ]);
  });

  it('detaches the cascade on stop(): a later poll reaches no producer', async () => {
    const { cascade, polling, indicators, quotes, barBridge } = await build();
    await cascade.start();
    const indicatorSpy = jest.spyOn(indicators, 'handleCandle');
    const quoteSpy = jest.spyOn(quotes, 'handleCandle');
    const barSpy = jest.spyOn(barBridge, 'handleCandle');

    cascade.stop();
    await polling.poll();

    expect(cascade.isLive).toBe(false);
    expect(indicatorSpy).not.toHaveBeenCalled();
    expect(quoteSpy).not.toHaveBeenCalled();
    expect(barSpy).not.toHaveBeenCalled();
  });

  it('stops the poll loop on stop()', async () => {
    const { cascade, polling } = await build();
    await cascade.start();
    const pollingStop = jest.spyOn(polling, 'stop');

    cascade.stop();

    expect(pollingStop).toHaveBeenCalledTimes(1);
  });

  it('tears the cascade down on application shutdown', async () => {
    const { cascade, polling } = await build();
    await cascade.start();
    const pollingStop = jest.spyOn(polling, 'stop');

    cascade.onApplicationShutdown();

    expect(pollingStop).toHaveBeenCalledTimes(1);
    expect(cascade.isLive).toBe(false);
  });

  it('is idempotent: a second start() composes the engine only once', async () => {
    const { cascade, startSpy } = await build();

    await cascade.start();
    await cascade.start();

    expect(startSpy).toHaveBeenCalledTimes(1);
  });
});
