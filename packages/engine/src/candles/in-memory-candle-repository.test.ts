import { describe } from 'vitest';
import { InMemoryCandleRepository } from './in-memory-candle-repository.js';
import { runCandleRepositoryContract } from './testing/candle-repository.contract.js';

describe('InMemoryCandleRepository (contract)', () => {
  runCandleRepositoryContract(() => new InMemoryCandleRepository());
});
