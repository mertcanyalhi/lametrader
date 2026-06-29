import {
  ConfigKey,
  type EquityCandle,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type IndicatorStateEvent,
  Period,
  StateValueType,
  type SymbolQuoteEvent,
  SymbolType,
} from '@lametrader/core';
import {
  BarLifecycleBridge,
  ConfigService,
  defaultIndicators,
  IndicatorCascadeBridge,
  IndicatorService,
  InMemoryCandleRepository,
  InMemoryConfigRepository,
  InMemoryMarketDataSource,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  PollingService,
  QuoteStreamService,
  StateCascadeBridge,
  TickBridge,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

const SYMBOL_QUOTED = 'stock:AAPL';
const SYMBOL_POLLED_ONLY = 'stock:MSFT';

/** Build an equity {@link EquityCandle} from minimal inputs. */
function equityCandle(time: number, close: number): EquityCandle {
  return {
    type: SymbolType.Stock,
    time,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1_000,
  };
}

/** Seed a watchlist with both the quoted symbol and the polled-only symbol. */
async function seedWatchlist(watchlist: InMemoryWatchlistRepository): Promise<void> {
  await watchlist.add({
    id: SYMBOL_QUOTED,
    type: SymbolType.Stock,
    description: 'Apple',
    exchange: 'NMS',
    periods: [Period.OneMinute],
  });
  await watchlist.add({
    id: SYMBOL_POLLED_ONLY,
    type: SymbolType.Stock,
    description: 'Microsoft',
    exchange: 'NMS',
    periods: [Period.OneMinute],
  });
}

/** Build an `InMemoryMarketDataSource` with both symbols and per-symbol candles. */
function buildSource(candlesById: Record<string, EquityCandle[]>): InMemoryMarketDataSource {
  return new InMemoryMarketDataSource(
    [
      { id: SYMBOL_QUOTED, type: SymbolType.Stock, description: 'Apple', exchange: 'NMS' },
      { id: SYMBOL_POLLED_ONLY, type: SymbolType.Stock, description: 'Microsoft', exchange: 'NMS' },
    ],
    [SymbolType.Stock],
    Object.entries(candlesById).map(([id, candles]) => ({
      id,
      period: Period.OneMinute,
      candles,
    })),
  );
}

describe('rules bridges (e2e)', () => {
  it('drives real PollingService + QuoteStreamService + IndicatorService + StateRepository through the v2 bridges and emits the expected EvaluationTriggerEvent stream', async () => {
    const emitted: EvaluationTriggerEvent[] = [];
    const sink = (event: EvaluationTriggerEvent): void => {
      emitted.push(event);
    };

    // ── Wire bridges ──
    const tickBridge = new TickBridge(sink);
    const barLifecycleBridge = new BarLifecycleBridge(sink);
    const stateCascadeBridge = new StateCascadeBridge(sink);
    const indicatorCascadeBridge = new IndicatorCascadeBridge(sink);

    // ── Seed infra ──
    const candleRepo = new InMemoryCandleRepository();
    const watchlist = new InMemoryWatchlistRepository();
    await seedWatchlist(watchlist);
    // Warm-up candles for AAPL so the quote service can compute a quote on first poll
    // and the SMA(2) indicator has enough history to emit a value at the inbound bar.
    await candleRepo.save(SYMBOL_QUOTED, Period.OneMinute, [
      equityCandle(998_000, 98),
      equityCandle(999_000, 99),
    ]);
    // PollingService skips a symbol+period with no stored candles (assumes backfill
    // ran first), so seed MSFT's prior bar too.
    await candleRepo.save(SYMBOL_POLLED_ONLY, Period.OneMinute, [equityCandle(999_000, 199)]);

    const source = buildSource({
      [SYMBOL_QUOTED]: [equityCandle(1_000_000, 105)],
      [SYMBOL_POLLED_ONLY]: [equityCandle(1_000_000, 200)],
    });

    // ── Quote stream → TickBridge (subscribed only for AAPL) ──
    const config = new ConfigService(
      new InMemoryConfigRepository([
        [ConfigKey.Periods, [Period.OneMinute]],
        [ConfigKey.DefaultPeriod, Period.OneMinute],
      ]),
    );
    const quoteStream = new QuoteStreamService(watchlist, config, candleRepo, {
      onQuote: (event: SymbolQuoteEvent) => tickBridge.handleQuote(event),
    });
    await quoteStream.subscribe(SYMBOL_QUOTED);

    // ── State repo → StateCascadeBridge ──
    const stateRepo = new InMemoryStateRepository();
    stateRepo.onStateChanged((event) => stateCascadeBridge.handleStateChange(event));

    // ── Indicator service → IndicatorCascadeBridge ──
    const indicators = defaultIndicators();
    const indicatorService = new IndicatorService(indicators, watchlist, candleRepo, {
      onState: (event: IndicatorStateEvent) => indicatorCascadeBridge.handleIndicatorState(event),
    });
    const indicatorSubId = await indicatorService.subscribe({
      id: SYMBOL_QUOTED,
      period: Period.OneMinute,
      indicatorKey: 'sma',
      inputs: { length: 2 },
    });
    indicatorCascadeBridge.bindSubscription(indicatorSubId, 'instance-sma-2', 'profile-A');

    // ── Polling fans out to all bridges per candle ──
    const polling = new PollingService([source], candleRepo, watchlist, {
      onCandle: (event) => {
        barLifecycleBridge.handleCandle(event);
        // QuoteStreamService also consumes candles to derive quotes for subscribed symbols.
        quoteStream.handleCandle(event);
        // IndicatorService recomputes per its own subscriptions; await chain handled below.
        indicatorEnqueue(() => indicatorService.handleCandle(event));
      },
      intervals: { [Period.OneMinute]: 60_000 } as Record<Period, number>,
      now: () => 1_500_000,
    });

    // The IndicatorService.handleCandle is async; the polling onCandle is sync, so we
    // schedule the recompute on a chained promise the test drains before asserting.
    let indicatorChain: Promise<void> = Promise.resolve();
    function indicatorEnqueue(work: () => Promise<void>): void {
      indicatorChain = indicatorChain.then(work);
    }

    // ── Drive: one poll round (forming bar on the inbound candle) ──
    await polling.poll();
    await indicatorChain;

    // ── A state mutation cascades through StateCascadeBridge ──
    await stateRepo.setSymbolState(
      'profile-A',
      SYMBOL_QUOTED,
      'breakout-armed',
      { type: StateValueType.Bool, value: true },
      1_200_000,
    );

    // ── Assert: polled-only symbol got BarOpened (no Tick); quoted got Tick too;
    //   cascade carried profileId ──
    const barOpenedForPolledOnly = emitted.filter(
      (e) => e.kind === EvaluationTriggerKind.BarOpened && e.symbolId === SYMBOL_POLLED_ONLY,
    );
    const tickForPolledOnly = emitted.filter(
      (e) => e.kind === EvaluationTriggerKind.Tick && e.symbolId === SYMBOL_POLLED_ONLY,
    );
    const tickForQuoted = emitted.filter(
      (e) => e.kind === EvaluationTriggerKind.Tick && e.symbolId === SYMBOL_QUOTED,
    );
    const barOpenedForQuoted = emitted.filter(
      (e) => e.kind === EvaluationTriggerKind.BarOpened && e.symbolId === SYMBOL_QUOTED,
    );
    const cascade = emitted.filter(
      (e) => e.kind === EvaluationTriggerKind.SymbolStateChanged && e.symbolId === SYMBOL_QUOTED,
    );
    const indicatorChanged = emitted.filter(
      (e) => e.kind === EvaluationTriggerKind.IndicatorChanged,
    );

    expect(barOpenedForPolledOnly).toEqual([
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 1_000_000,
        symbolId: SYMBOL_POLLED_ONLY,
        period: Period.OneMinute,
      },
    ]);
    expect(tickForPolledOnly).toEqual([]);
    expect(barOpenedForQuoted).toEqual([
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 1_000_000,
        symbolId: SYMBOL_QUOTED,
        period: Period.OneMinute,
      },
    ]);
    expect(tickForQuoted).toEqual([
      {
        kind: EvaluationTriggerKind.Tick,
        ts: 1_000_000,
        symbolId: SYMBOL_QUOTED,
        price: 105,
      },
    ]);
    expect(cascade).toEqual([
      {
        kind: EvaluationTriggerKind.SymbolStateChanged,
        ts: 1_200_000,
        symbolId: SYMBOL_QUOTED,
        profileId: 'profile-A',
        key: 'breakout-armed',
        prev: null,
        current: { type: StateValueType.Bool, value: true },
      },
    ]);
    expect(indicatorChanged).toEqual([
      {
        kind: EvaluationTriggerKind.IndicatorChanged,
        ts: 1_000_000,
        symbolId: SYMBOL_QUOTED,
        profileId: 'profile-A',
        instanceId: 'instance-sma-2',
        stateKey: 'value',
        prev: null,
        current: { type: StateValueType.Number, value: 102 },
      },
    ]);
  });

  it('critical failure mode — a re-poll of the same forming bar does not duplicate BarOpened', async () => {
    const emitted: EvaluationTriggerEvent[] = [];
    const barLifecycleBridge = new BarLifecycleBridge((event) => emitted.push(event));

    const candleRepo = new InMemoryCandleRepository();
    const watchlist = new InMemoryWatchlistRepository();
    await seedWatchlist(watchlist);
    // PollingService skips a symbol+period with no stored candles, so seed a prior bar.
    await candleRepo.save(SYMBOL_POLLED_ONLY, Period.OneMinute, [equityCandle(999_000, 199)]);
    // No upstream change between polls — the same forming candle is re-served.
    const source = buildSource({
      [SYMBOL_POLLED_ONLY]: [equityCandle(1_000_000, 200)],
    });
    const polling = new PollingService([source], candleRepo, watchlist, {
      onCandle: (event) => barLifecycleBridge.handleCandle(event),
      intervals: { [Period.OneMinute]: 60_000 } as Record<Period, number>,
      now: () => 1_500_000,
    });

    await polling.poll();
    await polling.poll();

    const barOpenedMsft = emitted.filter(
      (e) => e.kind === EvaluationTriggerKind.BarOpened && e.symbolId === SYMBOL_POLLED_ONLY,
    );
    expect(barOpenedMsft).toEqual([
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 1_000_000,
        symbolId: SYMBOL_POLLED_ONLY,
        period: Period.OneMinute,
      },
    ]);
  });
});
