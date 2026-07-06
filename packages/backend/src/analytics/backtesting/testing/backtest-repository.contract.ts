import {
  type Backtest,
  BacktestExitReason,
  type BacktestRepository,
  BacktestStatus,
  BacktestThresholdKind,
  Period,
  StateValueType,
} from '@lametrader/core';

/** The embedded strategy snapshot the sample backtests carry. */
const snapshot = {
  id: 'strat-1',
  name: 'Breakout',
  description: '',
  entry: { signal: { key: 'trend', value: { type: StateValueType.String, value: 'up' } } },
  exit: {
    signal: { key: 'trend', value: { type: StateValueType.String, value: 'down' } },
    profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 },
  },
  createdAt: 500,
  updatedAt: 500,
} as const;

/** Build a completed backtest for the contract, optionally with an open position. */
const backtest = (id: string, name = id, withOpen = false): Backtest => ({
  id,
  name,
  status: BacktestStatus.Completed,
  createdAt: 1000,
  updatedAt: 2000,
  params: {
    symbolId: 'BTCUSDT',
    profileId: 'prof-1',
    profileName: 'Momentum',
    period: Period.OneHour,
    start: 1_700_000_000_000,
    end: 1_700_086_400_000,
    initialCapital: 10_000,
    commission: { rate: 0.1, fixed: 1 },
  },
  strategyId: 'strat-1',
  strategy: { ...snapshot },
  trades: [
    {
      entryTs: 1_700_003_600_000,
      exitTs: 1_700_007_200_000,
      entryPrice: 100,
      exitPrice: 110,
      quantity: 1,
      commission: 2,
      pnl: 8,
      roiPct: 7.9,
      exitReason: BacktestExitReason.Signal,
    },
  ],
  ...(withOpen
    ? {
        openPosition: {
          entryTs: 1_700_010_800_000,
          entryPrice: 120,
          quantity: 0.5,
          entryCommission: 1,
          unrealizedPnl: 4,
        },
      }
    : {}),
  summary: {
    totalPnl: 8,
    roiPct: 0.08,
    avgPnlPerTrade: 8,
    tradeCount: 1,
    winners: 1,
    losers: 0,
    avgRoiPct: 7.9,
    avgDaysInTrade: 0.041_666_666_666_666_664,
  },
});

/** Sort by id so list assertions are order-independent across adapters. */
const byId = (a: Backtest, b: Backtest): number => a.id.localeCompare(b.id);

/**
 * The shared behavioural contract every {@link BacktestRepository} must satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongoose adapter in
 * the e2e (Testcontainers) tier. Together they prove the two behave identically,
 * including the verbatim round-trip of the embedded params / strategy snapshot /
 * trades / summary and the optional `openPosition`.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runBacktestRepositoryContract(
  make: () => BacktestRepository | Promise<BacktestRepository>,
): void {
  it('save then get round-trips a completed backtest verbatim', async () => {
    const repo = await make();
    await repo.save(backtest('b1'));
    expect(await repo.get('b1')).toEqual(backtest('b1'));
  });

  it('save then get round-trips an open position when present', async () => {
    const repo = await make();
    await repo.save(backtest('b1', 'b1', true));
    expect(await repo.get('b1')).toEqual(backtest('b1', 'b1', true));
  });

  it('list returns all saved backtests', async () => {
    const repo = await make();
    await repo.save(backtest('b1'));
    await repo.save(backtest('b2'));
    expect((await repo.list()).sort(byId)).toEqual([backtest('b1'), backtest('b2')]);
  });

  it('save replaces by id (no duplicate)', async () => {
    const repo = await make();
    await repo.save(backtest('b1', 'first'));
    await repo.save(backtest('b1', 'renamed'));
    expect(await repo.list()).toEqual([backtest('b1', 'renamed')]);
  });

  it('get returns null for an unknown id', async () => {
    const repo = await make();
    expect(await repo.get('nope')).toBeNull();
  });

  it('remove deletes, and is a no-op for an unknown id', async () => {
    const repo = await make();
    await repo.save(backtest('b1'));
    await repo.remove('b1');
    await repo.remove('b1');
    expect(await repo.get('b1')).toBeNull();
  });
}
