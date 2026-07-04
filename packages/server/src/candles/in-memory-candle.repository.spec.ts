import { InMemoryCandleRepository } from './in-memory-candle.repository.js';
import { runCandleRepositoryContract } from './testing/candle-repository.contract.js';

describe('InMemoryCandleRepository', () => {
  runCandleRepositoryContract(() => new InMemoryCandleRepository());
});
