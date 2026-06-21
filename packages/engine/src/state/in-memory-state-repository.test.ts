import { describe } from 'vitest';
import { InMemoryStateRepository } from './in-memory-state-repository.js';
import { runStateRepositoryContract } from './testing/state-repository.contract.js';

describe('InMemoryStateRepository', () => {
  runStateRepositoryContract(() => new InMemoryStateRepository());
});
