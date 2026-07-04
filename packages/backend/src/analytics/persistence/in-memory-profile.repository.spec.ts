import { runProfileRepositoryContract } from '../testing/profile-repository.contract.js';
import { InMemoryProfileRepository } from './in-memory-profile.repository.js';

describe('InMemoryProfileRepository', () => {
  runProfileRepositoryContract(() => new InMemoryProfileRepository());
});
