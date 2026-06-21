import { describe } from 'vitest';
import { InMemoryFiringStateRepository } from './in-memory-firing-state-repository.js';
import { runFiringStateRepositoryContract } from './testing/firing-state-repository.contract.js';

describe('InMemoryFiringStateRepository', () => {
  runFiringStateRepositoryContract(() => new InMemoryFiringStateRepository());
});
