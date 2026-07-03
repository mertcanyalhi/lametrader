import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import {
  IndicatorSeriesStore,
  InMemoryCandleRepository,
  InMemoryEventLog,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  wireRuleEngine,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

/**
 * E2e for issue #462: an `AllSymbols`-scoped `Once` rule fires exactly once
 * even when qualifying ticks for two different symbols are processed on
 * separate per-symbol chains concurrently (#307). The atomic
 * `RuleRepository.claimOnceFire` owns the lifetime once-ever invariant.
 */
describe('wireRuleEngine AllSymbols Once atomic claim (e2e)', () => {
  /** Build an AllSymbols `Once` rule that fires on `Price > 100`. */
  function onceRule(): Rule {
    return {
      id: 'r-once',
      profileId: 'profile-1',
      name: 'market-wide once',
      scope: { kind: RuleScopeKind.AllSymbols },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
        },
      },
      trigger: { kind: TriggerKind.Once },
      expiration: null,
      actions: [
        {
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'market-wide once fired',
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  it('fires exactly once when qualifying ticks for two symbols are processed concurrently, disabling the rule', async () => {
    const rules = new InMemoryRuleRepository();
    const eventLog = new InMemoryEventLog(() => 0);
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const notifier = new InMemoryNotifier(['main']);
    const candleRepository = new InMemoryCandleRepository();
    const indicatorStore = new IndicatorSeriesStore();
    await rules.save(onceRule());

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository,
      indicatorStore,
    });

    // Both ticks enqueue BEFORE draining, so AAPL and MSFT run on separate
    // per-symbol chains concurrently — the exact interleaving the issue
    // describes.
    wired.tickBridge.handleQuote({ id: 'AAPL', quote: { time: 1_000, price: 101, final: false } });
    wired.tickBridge.handleQuote({ id: 'MSFT', quote: { time: 1_000, price: 101, final: false } });
    await wired.drain();

    // Rule-scoped log is deterministic regardless of which symbol won the
    // claim: exactly one fire (one NotificationSent + one Fired).
    const ruleEvents = await eventLog.ruleEvents('r-once');
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'market-wide once fired' }]);
    expect((await rules.get('r-once'))?.enabled).toEqual(false);
  });

  it('does not fire again for a further qualifying tick on a third symbol after the claim is spent', async () => {
    const rules = new InMemoryRuleRepository();
    const eventLog = new InMemoryEventLog(() => 0);
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const notifier = new InMemoryNotifier(['main']);
    const candleRepository = new InMemoryCandleRepository();
    const indicatorStore = new IndicatorSeriesStore();
    await rules.save(onceRule());

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository,
      indicatorStore,
    });

    wired.tickBridge.handleQuote({ id: 'AAPL', quote: { time: 1_000, price: 101, final: false } });
    await wired.drain();
    wired.tickBridge.handleQuote({ id: 'GOOG', quote: { time: 2_000, price: 101, final: false } });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents('r-once');
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'market-wide once fired' }]);
  });
});
