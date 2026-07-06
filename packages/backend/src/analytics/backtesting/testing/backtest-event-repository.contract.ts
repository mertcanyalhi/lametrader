import {
  type BacktestEventRepository,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  StateValueType,
} from '@lametrader/core';

/** Build a `StateSet` run event stamped at source `ts`. */
const event = (ts: number, value: string): RuleEventEntry => ({
  type: RuleEventType.StateSet,
  ts,
  firedAt: ts,
  ruleId: 'rule-1',
  symbolId: 'BTCUSDT',
  scope: StateScope.Symbol,
  key: 'trend',
  value: { type: StateValueType.String, value },
});

/**
 * The shared behavioural contract every {@link BacktestEventRepository} must
 * satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongoose adapter in
 * the e2e (Testcontainers) tier. Together they prove the two behave identically:
 * append preserves emission order, `window` reads newest-first within the
 * `[from, to)` window and honours `limit`, `list` keeps append order, and events
 * are keyed by `backtestId` so one backtest's events never leak into another's.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runBacktestEventRepositoryContract(
  make: () => BacktestEventRepository | Promise<BacktestEventRepository>,
): void {
  it('append then list keeps engine emission (append) order', async () => {
    const repo = await make();
    await repo.append('b1', [event(10, 'up'), event(20, 'down')]);
    await repo.append('b1', [event(30, 'up')]);
    expect(await repo.list('b1')).toEqual([event(10, 'up'), event(20, 'down'), event(30, 'up')]);
  });

  it('window returns events newest-first', async () => {
    const repo = await make();
    await repo.append('b1', [event(10, 'up'), event(20, 'down'), event(30, 'up')]);
    expect(await repo.window('b1', {})).toEqual([
      event(30, 'up'),
      event(20, 'down'),
      event(10, 'up'),
    ]);
  });

  it('window applies the inclusive-from / exclusive-to bounds', async () => {
    const repo = await make();
    await repo.append('b1', [event(10, 'up'), event(20, 'down'), event(30, 'up')]);
    expect(await repo.window('b1', { from: 20, to: 30 })).toEqual([event(20, 'down')]);
  });

  it('window caps the page at limit (newest kept)', async () => {
    const repo = await make();
    await repo.append('b1', [event(10, 'up'), event(20, 'down'), event(30, 'up')]);
    expect(await repo.window('b1', { limit: 2 })).toEqual([event(30, 'up'), event(20, 'down')]);
  });

  it('events are scoped per backtest id', async () => {
    const repo = await make();
    await repo.append('b1', [event(10, 'up')]);
    await repo.append('b2', [event(20, 'down')]);
    expect(await repo.list('b2')).toEqual([event(20, 'down')]);
  });

  it('removeForBacktest deletes only that backtest, and is a no-op when absent', async () => {
    const repo = await make();
    await repo.append('b1', [event(10, 'up')]);
    await repo.append('b2', [event(20, 'down')]);
    await repo.removeForBacktest('b1');
    await repo.removeForBacktest('b1');
    expect(await repo.list('b1')).toEqual([]);
    expect(await repo.list('b2')).toEqual([event(20, 'down')]);
  });
}
