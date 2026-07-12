import {
  type Backtest,
  BacktestExitReason,
  type BacktestOpenPosition,
  type BacktestParams,
  BacktestStatus,
  type BacktestStrategy,
  type BacktestSummary,
  BacktestThresholdKind,
  type BacktestTrade,
  type Candle,
  Period,
  type Profile,
  ProfileScope,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  StateValueType,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { InMemoryProfileRepository } from '../persistence/in-memory-profile.repository.js';
import { BacktestService } from './backtest.service.js';
import { emptyBacktestSummary } from './backtest-executor.js';
import type {
  BacktestReplayHooks,
  BacktestReplayPort,
  BacktestReplayResult,
} from './backtest-replay.service.js';
import { InMemoryBacktestRepository } from './in-memory-backtest.repository.js';
import { InMemoryBacktestEventRepository } from './in-memory-backtest-event.repository.js';
import { InMemoryBacktestStrategyRepository } from './in-memory-backtest-strategy.repository.js';

/** A wall clock fixed after the run window's end. */
const NOW = 1_700_200_000_000;
/** The run window used throughout (exactly one day). */
const START = 1_700_000_000_000;
const END = 1_700_086_400_000;

/** A controllable replay fake: return canned events / trading-model output, hang forever, or observe cancel. */
class FakeReplay implements BacktestReplayPort {
  /** Events the run "recorded"; returned on a normal completion. */
  events: RuleEventEntry[] = [];
  /** Closed trades the trading model "produced". */
  trades: BacktestTrade[] = [];
  /** The position still open at the end, if any. */
  openPosition: BacktestOpenPosition | undefined = undefined;
  /** The summary over the closed trades. */
  summary: BacktestSummary = emptyBacktestSummary();
  /** When set, `replay` never resolves — the run stays in flight. */
  hang = false;
  /** The last `(params, periods)` a run was invoked with. */
  seen: { params: BacktestParams; periods: Period[] } | null = null;

  async replay(
    params: BacktestParams,
    _strategy: BacktestStrategy,
    _profile: Profile,
    periods: Period[],
    hooks?: BacktestReplayHooks,
  ): Promise<BacktestReplayResult> {
    this.seen = { params, periods };
    if (this.hang) {
      return new Promise<BacktestReplayResult>(() => {});
    }
    if (hooks?.isCancelled?.()) {
      return { events: [], trades: [], summary: emptyBacktestSummary(), cancelled: true };
    }
    return {
      events: this.events,
      trades: this.trades,
      ...(this.openPosition === undefined ? {} : { openPosition: this.openPosition }),
      summary: this.summary,
      cancelled: false,
    };
  }
}

/** A complete strategy snapshot. */
const strategy = (overrides: Partial<BacktestStrategy> = {}): BacktestStrategy => ({
  id: 'strat-1',
  name: 'Breakout',
  description: '',
  entry: { signal: { key: 'trend', value: { type: StateValueType.String, value: 'up' } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 } },
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

/** An enabled, all-scope profile. */
const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: 'prof-1',
  name: 'Momentum',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  indicators: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

/** A watched symbol with two active periods. */
const watched = (): WatchedSymbol => ({
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  name: 'Bitcoin',
  exchange: 'Binance',
  periods: [Period.OneHour, Period.OneMinute],
});

/** A crypto candle at `time`. */
const candle = (time: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 1,
  quoteVolume: 100,
  trades: 1,
});

/** A `StateSet` run event. */
const runEvent: RuleEventEntry = {
  type: RuleEventType.StateSet,
  ts: START,
  firedAt: START,
  ruleId: 'rule-1',
  symbolId: 'crypto:BTCUSDT',
  scope: StateScope.Symbol,
  key: 'trend',
  value: { type: StateValueType.String, value: 'up' },
};

/** A well-formed run request; tests override one field to make it invalid. */
const request = (overrides: Record<string, unknown> = {}) => ({
  strategyId: 'strat-1',
  symbolId: 'crypto:BTCUSDT',
  profileId: 'prof-1',
  period: Period.OneHour,
  start: START,
  end: END,
  initialCapital: 10_000,
  commission: { rate: 0.1, fixed: 1 },
  ...overrides,
});

/** The params a default run produces. */
const runParams = (): BacktestParams => ({
  symbolId: 'crypto:BTCUSDT',
  profileId: 'prof-1',
  profileName: 'Momentum',
  period: Period.OneHour,
  start: START,
  end: END,
  initialCapital: 10_000,
  commission: { rate: 0.1, fixed: 1 },
});

/** The completed backtest a default run persists. */
const completed = (overrides: Partial<Backtest> = {}): Backtest => ({
  id: 'bt-1',
  name: 'Breakout · crypto:BTCUSDT · 1h · 2023-11-14→2023-11-15',
  status: BacktestStatus.Completed,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: NOW,
  params: runParams(),
  strategyId: 'strat-1',
  strategy: strategy(),
  trades: [],
  summary: {
    totalPnl: 0,
    roiPct: 0,
    avgPnlPerTrade: 0,
    tradeCount: 0,
    winners: 0,
    losers: 0,
    avgRoiPct: 0,
    avgDaysInTrade: 0,
  },
  ...overrides,
});

/** Build a service over in-memory stores with deterministic id + clock. */
function build(
  seed: {
    strategies?: BacktestStrategy[];
    profiles?: Profile[];
    symbols?: WatchedSymbol[];
    candles?: boolean;
    backtests?: Backtest[];
    replay?: FakeReplay;
  } = {},
) {
  const backtests = new InMemoryBacktestRepository(seed.backtests ?? []);
  const events = new InMemoryBacktestEventRepository();
  const strategies = new InMemoryBacktestStrategyRepository(seed.strategies ?? [strategy()]);
  const profiles = new InMemoryProfileRepository(seed.profiles ?? [profile()]);
  const watchlist = new InMemoryWatchlistRepository(seed.symbols ?? [watched()]);
  const candles = new InMemoryCandleRepository();
  const replay = seed.replay ?? new FakeReplay();
  const service = new BacktestService(
    backtests,
    events,
    strategies,
    profiles,
    watchlist,
    candles,
    replay,
    {
      newId: () => 'bt-1',
      now: () => NOW,
    },
  );
  const ready =
    seed.candles === false
      ? Promise.resolve()
      : candles.save('crypto:BTCUSDT', Period.OneHour, [candle(START)]);
  return { service, backtests, events, strategies, profiles, watchlist, candles, replay, ready };
}

/** Poll `cond` across microtasks until true (hermetic — no fixed sleep). */
async function waitFor(cond: () => Promise<boolean> | boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await cond()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was not met in time');
}

describe('BacktestService.start validation', () => {
  it('rejects a start ≥ end with a 400 domain error', async () => {
    const { service, ready } = build();
    await ready;
    await expect(service.start(request({ start: END, end: END }))).rejects.toThrow(
      'start must be before end',
    );
  });

  it('rejects an end in the future with a 400 domain error', async () => {
    const { service, ready } = build();
    await ready;
    await expect(service.start(request({ end: NOW + 1 }))).rejects.toThrow(
      'end must not be in the future',
    );
  });

  it('rejects a non-positive initial capital with a 400 domain error', async () => {
    const { service, ready } = build();
    await ready;
    await expect(service.start(request({ initialCapital: 0 }))).rejects.toThrow(
      'initialCapital must be greater than zero',
    );
  });

  it('rejects a negative commission with a 400 domain error', async () => {
    const { service, ready } = build();
    await ready;
    await expect(service.start(request({ commission: { rate: -1 } }))).rejects.toThrow(
      'commission rate must not be negative',
    );
  });

  it('rejects a disabled profile with a 400 domain error', async () => {
    const { service, ready } = build({ profiles: [profile({ enabled: false })] });
    await ready;
    await expect(service.start(request())).rejects.toThrow('profile is disabled');
  });

  it('rejects an out-of-scope profile with a 400 domain error', async () => {
    const { service, ready } = build({
      profiles: [profile({ scope: { type: ProfileScope.Symbols, symbolIds: ['crypto:ETHUSDT'] } })],
    });
    await ready;
    await expect(service.start(request())).rejects.toThrow(
      'profile scope does not include the symbol',
    );
  });

  it('rejects an empty candle range with a backfill hint', async () => {
    const { service, ready } = build({ candles: false });
    await ready;
    await expect(service.start(request())).rejects.toThrow(
      'no stored candles in the requested range; backfill the symbol first',
    );
  });

  it('rejects an unknown strategy id with a 404 domain error', async () => {
    const { service, ready } = build({ strategies: [] });
    await ready;
    await expect(service.start(request())).rejects.toThrow('backtest strategy not found: strat-1');
  });

  it('rejects an unknown profile id with a 404 domain error', async () => {
    const { service, ready } = build({ profiles: [] });
    await ready;
    await expect(service.start(request())).rejects.toThrow('profile not found: prof-1');
  });

  it('rejects an unwatched symbol id with a 404 domain error', async () => {
    const { service, ready } = build({ symbols: [] });
    await ready;
    await expect(service.start(request())).rejects.toThrow('symbol not watched: crypto:BTCUSDT');
  });
});

describe('BacktestService run lifecycle', () => {
  it('returns the running backtest with initial progress and the run params', async () => {
    const replay = new FakeReplay();
    replay.hang = true;
    const { service, ready } = build({ replay });
    await ready;
    const running = await service.start(request());
    expect(running).toEqual({
      id: 'bt-1',
      name: 'Breakout · crypto:BTCUSDT · 1h · 2023-11-14→2023-11-15',
      status: BacktestStatus.Running,
      createdAt: NOW,
      updatedAt: NOW,
      params: runParams(),
      strategyId: 'strat-1',
      strategy: strategy(),
      trades: [],
      summary: completed().summary,
      progress: { elapsedDays: 0, totalDays: 1 },
    });
  });

  it('returns 409 when a second run starts while one is active', async () => {
    const replay = new FakeReplay();
    replay.hang = true;
    const { service, ready } = build({ replay });
    await ready;
    await service.start(request());
    await expect(service.start(request())).rejects.toThrow('a backtest run is already active');
  });

  it('feeds the symbol’s active periods to the replay', async () => {
    const replay = new FakeReplay();
    replay.hang = true;
    const { service, ready } = build({ replay });
    await ready;
    await service.start(request());
    expect(replay.seen?.periods).toEqual([Period.OneHour, Period.OneMinute]);
  });

  it('auto-persists the completed backtest under the run id on completion', async () => {
    const replay = new FakeReplay();
    replay.events = [runEvent];
    const { service, backtests, ready } = build({ replay });
    await ready;
    await service.start(request());
    await waitFor(async () => (await backtests.get('bt-1')) !== null);
    expect(await backtests.get('bt-1')).toEqual(completed());
  });

  it('persists the run events keyed by the backtest id', async () => {
    const replay = new FakeReplay();
    replay.events = [runEvent];
    const { service, events, backtests, ready } = build({ replay });
    await ready;
    await service.start(request());
    await waitFor(async () => (await backtests.get('bt-1')) !== null);
    expect(await events.list('bt-1')).toEqual([runEvent]);
  });

  it('persists the trading model output — trades, open position, and summary — on completion', async () => {
    const trade: BacktestTrade = {
      entryTs: START,
      exitTs: START + 3_600_000,
      entryPrice: 100,
      exitPrice: 120,
      quantity: 50,
      commission: 2,
      pnl: 998,
      roiPct: 9.98,
      exitReason: BacktestExitReason.ProfitTarget,
    };
    const openPosition: BacktestOpenPosition = {
      entryTs: START + 7_200_000,
      entryPrice: 120,
      quantity: 25,
      entryCommission: 1,
      unrealizedPnl: 79,
    };
    const summary: BacktestSummary = {
      totalPnl: 998,
      roiPct: 9.98,
      avgPnlPerTrade: 998,
      tradeCount: 1,
      winners: 1,
      losers: 0,
      avgRoiPct: 9.98,
      avgDaysInTrade: 0.0416666667,
    };
    const replay = new FakeReplay();
    replay.trades = [trade];
    replay.openPosition = openPosition;
    replay.summary = summary;
    const { service, backtests, ready } = build({ replay });
    await ready;
    await service.start(request());
    await waitFor(async () => (await backtests.get('bt-1')) !== null);
    expect(await backtests.get('bt-1')).toEqual(
      completed({ trades: [trade], openPosition, summary }),
    );
  });

  it('leaves the saved snapshot unchanged when the source strategy is later edited', async () => {
    const replay = new FakeReplay();
    const { service, backtests, strategies, ready } = build({ replay });
    await ready;
    await service.start(request());
    await waitFor(async () => (await backtests.get('bt-1')) !== null);
    await strategies.save(strategy({ name: 'Renamed' }));
    expect((await backtests.get('bt-1'))?.strategy.name).toEqual('Breakout');
  });
});

describe('BacktestService list / get', () => {
  it('merges the in-memory running backtest with the persisted ones', async () => {
    const replay = new FakeReplay();
    replay.hang = true;
    const { service, ready } = build({ replay, backtests: [completed({ id: 'old' })] });
    await ready;
    await service.start(request());
    const listed = await service.list();
    expect(listed.map((b) => b.id)).toEqual(['bt-1', 'old']);
  });

  it('filters the list by status', async () => {
    const replay = new FakeReplay();
    replay.hang = true;
    const { service, ready } = build({ replay, backtests: [completed({ id: 'old' })] });
    await ready;
    await service.start(request());
    const running = await service.list(BacktestStatus.Running);
    expect(running.map((b) => b.id)).toEqual(['bt-1']);
  });

  it('gets the running backtest with progress', async () => {
    const replay = new FakeReplay();
    replay.hang = true;
    const { service, ready } = build({ replay });
    await ready;
    await service.start(request());
    const got = await service.get('bt-1');
    expect('progress' in got && got.progress).toEqual({ elapsedDays: 0, totalDays: 1 });
  });

  it('throws 404 for an unknown id', async () => {
    const { service, ready } = build();
    await ready;
    await expect(service.get('ghost')).rejects.toThrow('backtest not found: ghost');
  });
});

describe('BacktestService rename', () => {
  it('renames a completed backtest', async () => {
    const { service, ready } = build({ backtests: [completed()] });
    await ready;
    expect(await service.rename('bt-1', 'My run')).toEqual(completed({ name: 'My run' }));
  });

  it('leaves completedAt unchanged while bumping updatedAt on rename', async () => {
    const earlier = NOW - 5 * 60_000;
    const { service, ready } = build({
      backtests: [completed({ createdAt: earlier, updatedAt: earlier, completedAt: earlier })],
    });
    await ready;
    expect(await service.rename('bt-1', 'My run')).toEqual(
      completed({ name: 'My run', createdAt: earlier, updatedAt: NOW, completedAt: earlier }),
    );
  });

  it('rejects renaming a running backtest with a 400 domain error', async () => {
    const replay = new FakeReplay();
    replay.hang = true;
    const { service, ready } = build({ replay });
    await ready;
    await service.start(request());
    await expect(service.rename('bt-1', 'nope')).rejects.toThrow(
      'cannot rename a running backtest',
    );
  });

  it('throws 404 renaming an unknown id', async () => {
    const { service, ready } = build();
    await ready;
    await expect(service.rename('ghost', 'x')).rejects.toThrow('backtest not found: ghost');
  });
});

describe('BacktestService delete', () => {
  it('cancels and discards a running backtest without persisting anything', async () => {
    const replay = new FakeReplay();
    replay.hang = true;
    const { service, backtests, ready } = build({ replay });
    await ready;
    await service.start(request());
    await service.remove('bt-1');
    expect(await backtests.list()).toEqual([]);
    await expect(service.get('bt-1')).rejects.toThrow('backtest not found: bt-1');
  });

  it('deletes a completed backtest and cascades its events', async () => {
    const { service, backtests, events, ready } = build({ backtests: [completed()] });
    await events.append('bt-1', [runEvent]);
    await ready;
    await service.remove('bt-1');
    expect(await backtests.get('bt-1')).toBeNull();
    expect(await events.list('bt-1')).toEqual([]);
  });

  it('throws 404 deleting an unknown id', async () => {
    const { service, ready } = build();
    await ready;
    await expect(service.remove('ghost')).rejects.toThrow('backtest not found: ghost');
  });
});

describe('BacktestService events', () => {
  it('returns the windowed run events of a completed backtest', async () => {
    const { service, events, ready } = build({ backtests: [completed()] });
    await events.append('bt-1', [runEvent]);
    await ready;
    expect(await service.listEvents('bt-1', {})).toEqual([runEvent]);
  });

  it('rejects reading events of a running backtest with a 400 domain error', async () => {
    const replay = new FakeReplay();
    replay.hang = true;
    const { service, ready } = build({ replay });
    await ready;
    await service.start(request());
    await expect(service.listEvents('bt-1', {})).rejects.toThrow(
      'run events are not available while the backtest is running',
    );
  });

  it('throws 404 reading events of an unknown id', async () => {
    const { service, ready } = build();
    await ready;
    await expect(service.listEvents('ghost', {})).rejects.toThrow('backtest not found: ghost');
  });
});
