import { describe } from 'vitest';

import { runRuleRepositoryContract } from '../testing/rule-repository.contract.js';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';

describe('InMemoryRuleRepository (v2)', () => {
  runRuleRepositoryContract(() => new InMemoryRuleRepository());
});
