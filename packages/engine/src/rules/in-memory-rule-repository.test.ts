import { describe } from 'vitest';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';
import { runRuleRepositoryContract } from './testing/rule-repository.contract.js';

describe('InMemoryRuleRepository', () => {
  runRuleRepositoryContract(() => new InMemoryRuleRepository());
});
