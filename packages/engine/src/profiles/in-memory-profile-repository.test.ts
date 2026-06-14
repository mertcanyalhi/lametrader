import { describe } from 'vitest';
import { InMemoryProfileRepository } from './in-memory-profile-repository.js';
import { runProfileRepositoryContract } from './testing/profile-repository.contract.js';

describe('InMemoryProfileRepository', () => {
  runProfileRepositoryContract(() => new InMemoryProfileRepository());
});
