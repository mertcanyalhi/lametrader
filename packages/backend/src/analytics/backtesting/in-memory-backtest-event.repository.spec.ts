import { InMemoryBacktestEventRepository } from './in-memory-backtest-event.repository.js';
import { runBacktestEventRepositoryContract } from './testing/backtest-event-repository.contract.js';

describe('InMemoryBacktestEventRepository', () => {
  runBacktestEventRepositoryContract(() => new InMemoryBacktestEventRepository());
});
