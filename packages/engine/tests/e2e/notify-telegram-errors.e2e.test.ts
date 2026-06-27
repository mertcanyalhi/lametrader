import {
  ActionKind,
  ConditionNodeKind,
  type Notifier,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import {
  InMemoryEventLog,
  InMemoryFiringStateRepository,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  wireRuleEngine,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

/**
 * E2e for #327 — covers `NotifyTelegram` failure modes end-to-end:
 *
 * - unknown destination — the notifier throws `UnknownDestinationError`
 *   from `send`;
 * - template render failure — the action's template references a token
 *   outside the fixed allow-list (`{symbolId}`, `{ts}`, `{prev}`,
 *   `{current}`);
 * - transport throws — a custom notifier raises a synthetic error;
 * - independence — a failing rule does not curtail an independent
 *   succeeding rule on the same inbound event.
 *
 * Each failure mode appends one `Error` rule-event entry to both the
 * rule and the symbol log; the notifier is not advanced past the failed
 * call.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

const ARMED_TRUE = { type: StateValueType.Bool as const, value: true };

function makeRule(id: string, triggerPrice: number, actions: Rule['actions'], order: number): Rule {
  return {
    id,
    profileId: PROFILE_ID,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Eq,
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: triggerPrice },
      },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions,
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order,
  };
}

function buildDriver(seedRules: Rule[], notifier?: Notifier) {
  const rules = new InMemoryRuleRepository(seedRules);
  const watchlist = new InMemoryWatchlistRepository();
  const state = new InMemoryStateRepository();
  const fallbackNotifier = notifier ?? new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({
    rules,
    watchlist,
    state,
    notifier: fallbackNotifier,
    eventLog,
    firingState,
  });
  return { rules, state, notifier: fallbackNotifier, eventLog, wired };
}

async function pushQuote(
  driver: ReturnType<typeof buildDriver>,
  price: number,
  time: number,
): Promise<void> {
  driver.wired.quoteBridge.handleQuote({
    subscriptionId: 's',
    id: SYMBOL_ID,
    period: Period.OneMinute,
    quote: { price, change: 0, changePct: 0, time },
    final: false,
  });
  await driver.wired.drain();
}

async function errorReasons(
  driver: ReturnType<typeof buildDriver>,
  ruleId: string,
): Promise<string[]> {
  const events = await driver.eventLog.ruleEvents(ruleId);
  return events
    .filter((event) => event.type === RuleEventType.Error)
    .map((event) => ('reason' in event ? event.reason : ''));
}

describe('NotifyTelegram error paths (e2e)', () => {
  it('an unknown destination produces an `Error` event on the rule log and the symbol log; the notifier is not advanced', async () => {
    const driver = buildDriver([
      makeRule(
        'bad-dest',
        10,
        [{ kind: ActionKind.NotifyTelegram, destinationName: 'missing', template: 'hi' }],
        1,
      ),
    ]);

    await pushQuote(driver, 10, 1_000);

    const symbolErrors = (await driver.eventLog.symbolEvents(SYMBOL_ID)).filter(
      (event) => event.type === RuleEventType.Error,
    );
    expect({
      notified: driver.notifier instanceof InMemoryNotifier ? driver.notifier.sent : [],
      ruleErrors: await errorReasons(driver, 'bad-dest'),
      symbolErrorCount: symbolErrors.length,
    }).toEqual({
      notified: [],
      ruleErrors: ['Unknown notifier destination: missing'],
      symbolErrorCount: 1,
    });
  });

  it('an unknown template token produces an `Error` event with the precise token in the reason', async () => {
    const driver = buildDriver([
      makeRule(
        'bad-template',
        20,
        [
          {
            kind: ActionKind.NotifyTelegram,
            destinationName: 'main',
            template: 'hello {nope}!',
          },
        ],
        1,
      ),
    ]);

    await pushQuote(driver, 20, 1_000);

    expect({
      notified: driver.notifier instanceof InMemoryNotifier ? driver.notifier.sent : [],
      ruleErrors: await errorReasons(driver, 'bad-template'),
    }).toEqual({
      notified: [],
      ruleErrors: ['unknown template token: {nope}'],
    });
  });

  it('a transport failure captured from the notifier becomes the `Error` reason', async () => {
    const throwing: Notifier = {
      async send(): Promise<void> {
        throw new Error('telegram down');
      },
    };
    const driver = buildDriver(
      [
        makeRule(
          'transport-fail',
          30,
          [
            { kind: ActionKind.SetSymbolState, key: 'armed', value: ARMED_TRUE },
            { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'fired' },
          ],
          1,
        ),
      ],
      throwing,
    );

    await pushQuote(driver, 30, 1_000);

    expect({
      ruleErrors: await errorReasons(driver, 'transport-fail'),
      // The preceding `SetSymbolState` ran successfully — the engine
      // does not roll the action chain back when a later action fails.
      stored: await driver.state.getSymbolState(PROFILE_ID, SYMBOL_ID, 'armed'),
    }).toEqual({
      ruleErrors: ['telegram down'],
      stored: ARMED_TRUE,
    });
  });

  it('a failing rule does not curtail an independent succeeding rule on the same quote', async () => {
    const driver = buildDriver([
      makeRule(
        'bad-dest',
        40,
        [{ kind: ActionKind.NotifyTelegram, destinationName: 'missing', template: 'hi' }],
        1,
      ),
      makeRule(
        'good-dest',
        40,
        [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'good' }],
        2,
      ),
    ]);

    await pushQuote(driver, 40, 1_000);

    const goodFires = (await driver.eventLog.ruleEvents('good-dest')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier instanceof InMemoryNotifier ? driver.notifier.sent : [],
      badErrors: await errorReasons(driver, 'bad-dest'),
      goodFires: goodFires.length,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'good' }],
      badErrors: ['Unknown notifier destination: missing'],
      goodFires: 1,
    });
  });
});
