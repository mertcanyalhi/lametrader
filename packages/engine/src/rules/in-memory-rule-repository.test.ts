import { describe } from 'vitest';
import { InMemoryProfileRepository } from '../profiles/in-memory-profile-repository.js';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';
import { runRuleRepositoryContract } from './testing/rule-repository.contract.js';

describe('InMemoryRuleRepository', () => {
  runRuleRepositoryContract(() => {
    const profiles = new InMemoryProfileRepository();
    return { repo: new InMemoryRuleRepository([], profiles), profiles };
  });
});
