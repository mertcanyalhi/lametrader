import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  type Profile,
  type ProfileRepository,
  ProfileScope,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';

import { InMemoryProfileRepository } from '../persistence/in-memory-profile.repository.js';
import { InMemoryRuleRepository } from './in-memory-rule.repository.js';
import { runRuleRepositoryContract } from './testing/rule-repository.contract.js';

/**
 * The in-memory adapter drives the shared {@link runRuleRepositoryContract}
 * suite — the same suite the Mongo adapter runs in the e2e tier.
 */
runRuleRepositoryContract(() => {
  const profiles = new InMemoryProfileRepository();
  const repo = new InMemoryRuleRepository([], profiles);
  return { repo, profiles };
});

/** Counts `get`/`list` calls so the profile-enabled filter's query shape is observable. */
class CountingProfileRepository implements ProfileRepository {
  getCalls = 0;
  listCalls = 0;

  constructor(private readonly delegate: ProfileRepository) {}

  async list(): Promise<Profile[]> {
    this.listCalls++;
    return this.delegate.list();
  }

  async get(id: string): Promise<Profile | null> {
    this.getCalls++;
    return this.delegate.get(id);
  }

  async save(profile: Profile): Promise<void> {
    return this.delegate.save(profile);
  }

  async remove(id: string): Promise<void> {
    return this.delegate.remove(id);
  }
}

/** Build a minimal enabled profile. */
function profile(id: string): Profile {
  return {
    id,
    name: id,
    description: '',
    enabled: true,
    scope: { type: ProfileScope.All },
    indicators: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Build a minimal enabled AAPL rule under a profile. */
function rule(id: string, profileId: string, order: number): Rule {
  return {
    id,
    profileId,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: { kind: OperandKind.Price },
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
      },
    },
    trigger: { kind: TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'fired',
      },
    ],
    enabled: true,
    order,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('InMemoryRuleRepository profile-enabled filter', () => {
  it('resolves the profile-enabled filter without one query per profile (no N+1)', async () => {
    const profiles = new CountingProfileRepository(
      new InMemoryProfileRepository([profile('profile-1'), profile('profile-2')]),
    );
    const repo = new InMemoryRuleRepository([], profiles);
    await repo.save(rule('r1', 'profile-1', 0));
    await repo.save(rule('r2', 'profile-2', 1));
    const enabled = await repo.listEnabledForSymbol('AAPL');
    expect(enabled.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(profiles.getCalls).toBe(0);
    expect(profiles.listCalls).toBe(1);
  });
});
