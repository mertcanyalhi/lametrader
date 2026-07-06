import { InMemoryBacktestRepository } from './in-memory-backtest.repository.js';
import { runBacktestRepositoryContract } from './testing/backtest-repository.contract.js';

describe('InMemoryBacktestRepository', () => {
  runBacktestRepositoryContract(() => new InMemoryBacktestRepository());
});
