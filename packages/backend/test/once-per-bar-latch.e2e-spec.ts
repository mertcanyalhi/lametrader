import {
  ActionKind,
  type BarOpenedEvent,
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  Period,
  type Rule,
  RuleScopeKind,
  StateValueType,
  type TickEvent,
  TriggerKind,
} from '@lametrader/core';
import { Redis } from 'ioredis';
import { TriggerDispatcher } from '../src/analytics/rules/dispatch/dispatcher.js';
import { RedisOncePerBarLatchStore } from '../src/analytics/rules/dispatch/redis-once-per-bar-latch.store.js';
import type { EvaluationContext } from '../src/analytics/rules/evaluation-context.types.js';
import { InMemoryRuleRepository } from '../src/analytics/rules/in-memory-rule.repository.js';
import type { SeriesView } from '../src/analytics/rules/series.types.js';

/**
 * The headline #513 proof, over a real Redis (Testcontainers): a `OncePerBar`
 * rule that fired this bar must NOT re-fire after a restart — a fresh
 * `TriggerDispatcher` built over a new {@link RedisOncePerBarLatchStore} sharing
 * the same Redis still sees the latch. The in-memory `Set` this replaces would
 * have re-fired (the bug the issue reports).
 *
 * `REDIS_URL` is published by `test/global-setup.ts`; the e2e tier runs
 * `--runInBand`, so the per-test `flushdb` never races another suite.
 */
describe('OncePerBar latch survives restart (e2e, Redis)', () => {
  let redis: Redis;

  beforeEach(async () => {
    const url = process.env.REDIS_URL;
    if (url === undefined) throw new Error('REDIS_URL must be set by test/global-setup.ts');
    redis = new Redis(url);
    await redis.flushdb();
  }, 120_000);

  afterEach(async () => {
    await redis.quit();
  });

  /**
   * A brand-new dispatcher over a fresh Redis-backed store sharing `redis` —
   * each call models a separate process instance (a restart) over the one
   * persistent latch.
   */
  function buildDispatcher(rules: InMemoryRuleRepository): TriggerDispatcher {
    return new TriggerDispatcher({
      rules,
      latchStore: new RedisOncePerBarLatchStore(redis),
      buildContext: () => priceContext(120),
    });
  }

  it('does not re-fire a OncePerBar rule after a restart within the same bar', async () => {
    const rules = new InMemoryRuleRepository();
    await rules.save(oncePerBarRule());

    const before = buildDispatcher(rules);
    const beforeFires = await before.dispatch(tick(1_000));

    // Restart: a new dispatcher + store instance over the SAME Redis.
    const restarted = buildDispatcher(rules);
    const afterFires = await restarted.dispatch(tick(2_000));

    expect({
      before: beforeFires.map((f) => f.ruleId),
      after: afterFires.map((f) => f.ruleId),
    }).toEqual({ before: ['r1'], after: [] });
  });

  it('fires again after an explicit BarOpened re-arm following a restart', async () => {
    const rules = new InMemoryRuleRepository();
    await rules.save(oncePerBarRule());

    const before = buildDispatcher(rules);
    await before.dispatch(tick(1_000));

    // Restart, then the next bar opens — the re-arm clears the persistent latch.
    const restarted = buildDispatcher(rules);
    await restarted.dispatch(barOpened(60_000));
    const fires = await restarted.dispatch(tick(61_000));

    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });
});

/** A `Price > 100`, `OncePerBar` (1m), Symbol-scoped AAPL rule. */
function oncePerBarRule(): Rule {
  return {
    id: 'r1',
    profileId: 'profile-1',
    name: 'once per bar',
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
    trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
    expiration: null,
    actions: [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'price up',
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** A fake context resolving Price to `price` and Literals to their own value. */
function priceContext(price: number): EvaluationContext {
  const emptySeries: SeriesView = { length: 0, backwardWalk: () => [].values(), asOf: () => null };
  return {
    symbolId: 'AAPL',
    resolveLatest(operand) {
      if (operand.kind === OperandKind.Price) return { type: StateValueType.Number, value: price };
      if (operand.kind === OperandKind.Literal) return operand.value;
      return null;
    },
    resolvePrev(operand) {
      if (operand.kind === OperandKind.Literal) return operand.value;
      return null;
    },
    resolveSeries() {
      return emptySeries;
    },
  };
}

/** A Tick on AAPL at `ts` carrying a price of 120 (> 100 ⇒ condition true). */
function tick(ts: number): TickEvent {
  return { kind: EvaluationTriggerKind.Tick, ts, symbolId: 'AAPL', price: 120 };
}

/** A 1-minute BarOpened on AAPL at `ts`. */
function barOpened(ts: number): BarOpenedEvent {
  return { kind: EvaluationTriggerKind.BarOpened, ts, symbolId: 'AAPL', period: Period.OneMinute };
}
