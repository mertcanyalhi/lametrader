import {
  type BacktestStrategy,
  type BacktestStrategyRepository,
  BacktestThresholdKind,
  StateValueType,
} from '@lametrader/core';

/** Build a simple strategy for the contract. */
const strategy = (id: string, name = id): BacktestStrategy => ({
  id,
  name,
  description: '',
  entry: {
    signal: { key: 'trend', value: { type: StateValueType.String, value: 'up' } },
  },
  exit: {
    signal: { key: 'trend', value: { type: StateValueType.String, value: 'down' } },
    profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 },
    stopLoss: { kind: BacktestThresholdKind.Fixed, amount: 10 },
  },
  createdAt: 1000,
  updatedAt: 1000,
});

/** Sort by id so list assertions are order-independent across adapters. */
const byId = (a: BacktestStrategy, b: BacktestStrategy): number => a.id.localeCompare(b.id);

/**
 * The shared behavioural contract every {@link BacktestStrategyRepository} must
 * satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongoose adapter in
 * the e2e (Testcontainers) tier. Together they prove the two behave identically,
 * including the verbatim round-trip of the embedded tagged `entry` / `exit`
 * unions.
 *
 * Uses Jest's ambient globals (`it`, `expect`); the caller wraps the calls in a
 * `describe`.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runBacktestStrategyRepositoryContract(
  make: () => BacktestStrategyRepository | Promise<BacktestStrategyRepository>,
): void {
  it('save then get round-trips the strategy verbatim', async () => {
    const repo = await make();
    await repo.save(strategy('s1'));
    expect(await repo.get('s1')).toEqual(strategy('s1'));
  });

  it('list returns all saved strategies', async () => {
    const repo = await make();
    await repo.save(strategy('s1'));
    await repo.save(strategy('s2'));
    expect((await repo.list()).sort(byId)).toEqual([strategy('s1'), strategy('s2')]);
  });

  it('save replaces by id (no duplicate)', async () => {
    const repo = await make();
    await repo.save(strategy('s1', 'first'));
    await repo.save(strategy('s1', 'second'));
    expect(await repo.list()).toEqual([strategy('s1', 'second')]);
  });

  it('get returns null for an unknown id', async () => {
    const repo = await make();
    expect(await repo.get('nope')).toBeNull();
  });

  it('remove deletes, and is a no-op for an unknown id', async () => {
    const repo = await make();
    await repo.save(strategy('s1'));
    await repo.remove('s1');
    await repo.remove('s1');
    expect(await repo.get('s1')).toBeNull();
  });
}
