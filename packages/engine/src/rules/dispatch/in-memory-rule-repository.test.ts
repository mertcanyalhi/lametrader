import { InMemoryProfileRepository } from '../../profiles/in-memory-profile-repository.js';
import { runRuleRepositoryContract } from '../testing/rule-repository.contract.js';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';

/**
 * The in-memory adapter drives the shared {@link runRuleRepositoryContract}
 * suite — the same suite the Mongo adapter runs in the e2e tier.
 */
runRuleRepositoryContract(() => {
  const profiles = new InMemoryProfileRepository();
  const repo = new InMemoryRuleRepository([], profiles);
  return { repo, profiles };
});
