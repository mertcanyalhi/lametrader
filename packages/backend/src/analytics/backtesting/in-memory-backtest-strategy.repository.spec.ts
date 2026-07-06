import { InMemoryBacktestStrategyRepository } from './in-memory-backtest-strategy.repository.js';
import { runBacktestStrategyRepositoryContract } from './testing/backtest-strategy-repository.contract.js';

describe('InMemoryBacktestStrategyRepository', () => {
  runBacktestStrategyRepositoryContract(() => new InMemoryBacktestStrategyRepository());
});
