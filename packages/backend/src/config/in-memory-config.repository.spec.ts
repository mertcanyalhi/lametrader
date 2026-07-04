import { InMemoryConfigRepository } from './in-memory-config.repository.js';
import { runConfigRepositoryContract } from './testing/config-repository.contract.js';

describe('InMemoryConfigRepository', () => {
  runConfigRepositoryContract(() => new InMemoryConfigRepository());
});
