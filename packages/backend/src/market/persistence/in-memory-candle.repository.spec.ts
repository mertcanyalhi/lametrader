import { runCandleRepositoryContract } from '../testing/candle-repository.contract.js';
import { InMemoryCandleRepository } from './in-memory-candle.repository.js';

describe('InMemoryCandleRepository', () => {
  runCandleRepositoryContract(() => new InMemoryCandleRepository());
});
