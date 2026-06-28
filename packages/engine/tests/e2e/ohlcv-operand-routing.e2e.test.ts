import {
  ActionKind,
  ConditionNodeKind,
  type EquityCandle,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  SymbolType,
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
 * E2e for #323 — OHLCV cross-axis isolation.
 *
 * `CandleRuleEventBridge` dedupes per-axis via its `PrevCurrentCache`, so a
 * candle where only one OHLCV field changed emits exactly one event. Each
 * test seeds five `Once × Gt 1000` rules (one per axis), warms the bridge
 * cache and `LiveEvaluationLookups` with an all-zeros candle below the
 * threshold (so the warmup itself fires no rules), then pushes a mutation
 * candle and asserts the per-rule fire counts.
 *
 * `CurrentValue` is out of scope per the parent issue.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';
const THRESHOLD = 1_000;

type OhlcvField = 'open' | 'high' | 'low' | 'close' | 'volume';

const FIELDS: ReadonlyArray<{ id: string; field: OhlcvField; operand: OperandKind }> = [
  { id: 'open-rule', field: 'open', operand: OperandKind.OpenValue },
  { id: 'high-rule', field: 'high', operand: OperandKind.HighValue },
  { id: 'low-rule', field: 'low', operand: OperandKind.LowValue },
  { id: 'close-rule', field: 'close', operand: OperandKind.CloseValue },
  { id: 'volume-rule', field: 'volume', operand: OperandKind.VolumeValue },
];

function fieldRule(id: string, operand: OperandKind): Rule {
  return {
    id,
    profileId: PROFILE_ID,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: operand, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: THRESHOLD },
      },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: id }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order: 1,
  };
}

function candle(
  time: number,
  axes: { open: number; high: number; low: number; close: number; volume: number },
): EquityCandle {
  return { type: SymbolType.Stock, time, ...axes };
}

function buildDriver() {
  const rules = new InMemoryRuleRepository(FIELDS.map(({ id, operand }) => fieldRule(id, operand)));
  const watchlist = new InMemoryWatchlistRepository();
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({ rules, watchlist, state, notifier, eventLog, firingState });
  return { rules, notifier, eventLog, wired };
}

async function pushCandle(
  driver: ReturnType<typeof buildDriver>,
  time: number,
  axes: { open: number; high: number; low: number; close: number; volume: number },
  final = false,
): Promise<void> {
  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(time, axes),
    final,
  });
  await driver.wired.drain();
}

async function fireCounts(driver: ReturnType<typeof buildDriver>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const { id } of FIELDS) {
    const events = await driver.eventLog.ruleEvents(id);
    out[id] = events.filter((event) => event.type === RuleEventType.Fired).length;
  }
  return out;
}

describe('OHLCV operand routing (e2e)', () => {
  it('a candle where only `Open` changed fires only the Open rule', async () => {
    const driver = buildDriver();

    // Warmup with all-zeros — populates the bridge cache and lookups; no
    // rule fires because every condition is `> 1000`.
    await pushCandle(driver, 0, { open: 0, high: 0, low: 0, close: 0, volume: 0 });
    // Mutate only `open` above threshold.
    await pushCandle(driver, 1_000, { open: 2_000, high: 0, low: 0, close: 0, volume: 0 });

    expect({ notified: driver.notifier.sent, fires: await fireCounts(driver) }).toEqual({
      notified: [{ destinationName: 'main', body: 'open-rule' }],
      fires: { 'open-rule': 1, 'high-rule': 0, 'low-rule': 0, 'close-rule': 0, 'volume-rule': 0 },
    });
  });

  it('a candle where only `Close` changed (`final: true`) fires only the Close rule', async () => {
    const driver = buildDriver();

    await pushCandle(driver, 0, { open: 0, high: 0, low: 0, close: 0, volume: 0 });
    await pushCandle(driver, 1_000, { open: 0, high: 0, low: 0, close: 2_000, volume: 0 }, true);

    expect({ notified: driver.notifier.sent, fires: await fireCounts(driver) }).toEqual({
      notified: [{ destinationName: 'main', body: 'close-rule' }],
      fires: { 'open-rule': 0, 'high-rule': 0, 'low-rule': 0, 'close-rule': 1, 'volume-rule': 0 },
    });
  });

  it('a candle where Open, High, and Close all changed fires Open, High, and Close — Low and Volume stay silent', async () => {
    const driver = buildDriver();

    await pushCandle(driver, 0, { open: 0, high: 0, low: 0, close: 0, volume: 0 });
    await pushCandle(driver, 1_000, {
      open: 2_000,
      high: 2_100,
      low: 0,
      close: 2_050,
      volume: 0,
    });

    const byBody = (a: { body: string }, b: { body: string }) => a.body.localeCompare(b.body);
    expect({
      notified: [...driver.notifier.sent].sort(byBody),
      fires: await fireCounts(driver),
    }).toEqual({
      notified: [
        { destinationName: 'main', body: 'close-rule' },
        { destinationName: 'main', body: 'high-rule' },
        { destinationName: 'main', body: 'open-rule' },
      ],
      fires: { 'open-rule': 1, 'high-rule': 1, 'low-rule': 0, 'close-rule': 1, 'volume-rule': 0 },
    });
  });

  it('a candle whose Volume is unchanged emits no `VolumeValueChanged` and the Volume rule stays silent', async () => {
    const driver = buildDriver();

    // Warmup volume at 0; mutation candle still has volume at 0 → no
    // `VolumeValueChanged` event from the bridge's prev/current cache.
    await pushCandle(driver, 0, { open: 0, high: 0, low: 0, close: 0, volume: 0 });
    await pushCandle(driver, 1_000, { open: 2_000, high: 0, low: 0, close: 0, volume: 0 });

    const fires = await fireCounts(driver);
    expect(fires['volume-rule']).toBe(0);
  });
});
