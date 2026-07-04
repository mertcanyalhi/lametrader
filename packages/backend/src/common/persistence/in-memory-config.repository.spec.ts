import { runConfigRepositoryContract } from '../testing/config-repository.contract.js';
import { InMemoryConfigRepository } from './in-memory-config.repository.js';

describe('InMemoryConfigRepository', () => {
  runConfigRepositoryContract(() => new InMemoryConfigRepository());
});
