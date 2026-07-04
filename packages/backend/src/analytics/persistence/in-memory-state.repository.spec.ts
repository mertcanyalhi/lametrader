import { runStateRepositoryContract } from '../testing/state-repository.contract.js';
import { InMemoryStateRepository } from './in-memory-state.repository.js';

describe('InMemoryStateRepository', () => {
  runStateRepositoryContract(() => new InMemoryStateRepository());
});
