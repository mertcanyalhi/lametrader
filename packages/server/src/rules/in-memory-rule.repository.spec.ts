import { InMemoryProfileRepository } from '../profiles/in-memory-profile.repository.js';
import { InMemoryRuleRepository } from './in-memory-rule.repository.js';
import { runRuleRepositoryContract } from './testing/rule-repository.contract.js';

/**
 * Runs the shared {@link import('@lametrader/core').RuleRepository} contract
 * against the in-memory adapter — the unit half of the suite whose e2e half runs
 * the Mongoose adapter over a real Mongo. Each case gets a fresh repo + profile
 * repo pair; the in-memory rule repo consults the profile repo for the
 * `profile.enabled` filter its `listEnabledForSymbol` enforces.
 */
describe('InMemoryRuleRepository', () => {
  runRuleRepositoryContract(() => {
    const profiles = new InMemoryProfileRepository();
    return { repo: new InMemoryRuleRepository([], profiles), profiles };
  });
});
