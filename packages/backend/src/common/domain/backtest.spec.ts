import {
  type BacktestStrategy,
  BacktestThresholdKind,
  Period,
  type Profile,
  ProfileScope,
  StateValueType,
} from '@lametrader/core';
import {
  assertProfileRunnable,
  assertReplayCandleBudget,
  assertStrategyRunnable,
  BacktestError,
  type BacktestRunRequest,
  generateBacktestName,
  MAX_REPLAY_CANDLES,
  validateRunWindow,
} from './backtest.js';

/** A well-formed run request; individual tests override one field to make it invalid. */
const request = (overrides: Partial<BacktestRunRequest> = {}): BacktestRunRequest => ({
  strategyId: 'strat-1',
  symbolId: 'crypto:BTCUSDT',
  profileId: 'prof-1',
  period: Period.OneHour,
  start: 1_700_000_000_000,
  end: 1_700_086_400_000,
  initialCapital: 10_000,
  commission: { rate: 0.1, fixed: 1 },
  ...overrides,
});

/** A complete strategy (entry signal + one exit mechanism). */
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

/** An enabled profile scoped to all symbols. */
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

/** A time comfortably after the request window's end. */
const NOW = 1_700_200_000_000;

describe('validateRunWindow', () => {
  it('accepts a well-formed window and returns nothing', () => {
    expect(validateRunWindow(request(), NOW)).toBeUndefined();
  });

  it('rejects a start that is not before the end', () => {
    expect(() => validateRunWindow(request({ start: 1_700_086_400_000 }), NOW)).toThrow(
      new BacktestError('start must be before end'),
    );
  });

  it('rejects an end in the future', () => {
    expect(() => validateRunWindow(request(), 1_700_000_000_000)).toThrow(
      new BacktestError('end must not be in the future'),
    );
  });

  it('rejects a non-positive initial capital', () => {
    expect(() => validateRunWindow(request({ initialCapital: 0 }), NOW)).toThrow(
      new BacktestError('initialCapital must be greater than zero'),
    );
  });

  it('rejects a negative commission rate', () => {
    expect(() => validateRunWindow(request({ commission: { rate: -1 } }), NOW)).toThrow(
      new BacktestError('commission rate must not be negative'),
    );
  });

  it('rejects a negative commission fixed', () => {
    expect(() => validateRunWindow(request({ commission: { fixed: -1 } }), NOW)).toThrow(
      new BacktestError('commission fixed must not be negative'),
    );
  });
});

describe('assertStrategyRunnable', () => {
  it('accepts a complete strategy and returns nothing', () => {
    expect(assertStrategyRunnable(strategy())).toBeUndefined();
  });

  it('rejects a strategy with no exit mechanism', () => {
    expect(() => assertStrategyRunnable(strategy({ exit: {} }))).toThrow(
      new BacktestError('strategy must define at least one exit mechanism'),
    );
  });
});

describe('assertProfileRunnable', () => {
  it('accepts an enabled all-scope profile and returns nothing', () => {
    expect(assertProfileRunnable(profile(), 'crypto:BTCUSDT')).toBeUndefined();
  });

  it('accepts an enabled symbols-scope profile that includes the symbol', () => {
    const scoped = profile({
      scope: { type: ProfileScope.Symbols, symbolIds: ['crypto:BTCUSDT'] },
    });
    expect(assertProfileRunnable(scoped, 'crypto:BTCUSDT')).toBeUndefined();
  });

  it('rejects a disabled profile', () => {
    expect(() => assertProfileRunnable(profile({ enabled: false }), 'crypto:BTCUSDT')).toThrow(
      new BacktestError('profile is disabled'),
    );
  });

  it('rejects a profile whose scope excludes the symbol', () => {
    const scoped = profile({
      scope: { type: ProfileScope.Symbols, symbolIds: ['crypto:ETHUSDT'] },
    });
    expect(() => assertProfileRunnable(scoped, 'crypto:BTCUSDT')).toThrow(
      new BacktestError('profile scope does not include the symbol'),
    );
  });
});

describe('assertReplayCandleBudget', () => {
  it('passes when the summed candle count across periods is within the cap', () => {
    expect(() => assertReplayCandleBudget([500_000, 400_000], MAX_REPLAY_CANDLES)).not.toThrow();
  });

  it('passes when the summed candle count exactly equals the cap', () => {
    expect(() => assertReplayCandleBudget([600_000, 400_000], MAX_REPLAY_CANDLES)).not.toThrow();
  });

  it('rejects when the summed candle count across periods exceeds the cap', () => {
    expect(() => assertReplayCandleBudget([600_000, 600_000], MAX_REPLAY_CANDLES)).toThrow(
      new BacktestError(
        `backtest window is too large: 1200000 candles exceed the ${MAX_REPLAY_CANDLES} cap — narrow the range or drop a period`,
      ),
    );
  });
});

describe('generateBacktestName', () => {
  it('renders {strategy} · {symbol} · {period} · {start}→{end} with UTC dates', () => {
    const name = generateBacktestName(
      {
        symbolId: 'crypto:BTCUSDT',
        period: Period.OneHour,
        start: 1_700_000_000_000,
        end: 1_700_086_400_000,
      },
      'Breakout',
    );
    expect(name).toEqual('Breakout · crypto:BTCUSDT · 1h · 2023-11-14→2023-11-15');
  });
});
