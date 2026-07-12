import {
  type ConditionNode,
  ConditionNodeKind,
  CrossingOperator,
  type IndicatorInstance,
  type LeafCondition,
  LeafConditionFamily,
  MovingOperator,
  OperandKind,
  Period,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { defaultIndicators } from '../indicators/default-indicators.js';
import { derivePreloadBars } from './derive-preload-bars.js';

/** Wrap a single leaf as a one-node condition tree. */
const leafNode = (leaf: LeafCondition): ConditionNode => ({ kind: ConditionNodeKind.Leaf, leaf });

/** A `Moving` leaf on the 1m close over `lookbackBars`. */
const movingLeaf = (lookbackBars: number): LeafCondition => ({
  family: LeafConditionFamily.Moving,
  operator: MovingOperator.MovingUp,
  left: { kind: OperandKind.Close },
  threshold: 5,
  lookbackBars,
  interval: Period.OneMinute,
});

/** A `Crossing` leaf (unbounded backward walk — contributes no static depth). */
const crossingLeaf = (): LeafCondition => ({
  family: LeafConditionFamily.Crossing,
  operator: CrossingOperator.CrossingUp,
  left: { kind: OperandKind.Close },
  right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
  interval: Period.OneMinute,
});

/** Stamp a persisted rule carrying `condition`; only the condition is read by the analyzer. */
const rule = (condition: ConditionNode): Rule => ({
  id: 'rule-1',
  profileId: 'prof-1',
  name: 'r',
  scope: { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
  condition,
  trigger: { kind: TriggerKind.EveryTime },
  expiration: null,
  actions: [],
  enabled: true,
  order: 1,
  createdAt: 0,
  updatedAt: 0,
});

/** An SMA indicator instance of the given length (warmup === length). */
const smaInstance = (length: number, id = 'ind-1'): IndicatorInstance => ({
  id,
  indicatorKey: 'sma',
  inputs: { length, source: 'close' },
});

describe('derivePreloadBars', () => {
  it('is the max indicator warmup plus the page margin for a warmup-only profile', () => {
    const bars = derivePreloadBars([], [smaInstance(200)], defaultIndicators());

    expect(bars).toEqual(264);
  });

  it('is the max Moving lookback plus one plus the page margin for a moving-only profile', () => {
    const bars = derivePreloadBars([rule(leafNode(movingLeaf(20)))], [], defaultIndicators());

    expect(bars).toEqual(85);
  });

  it('sums the max warmup and the max Moving lookback for a combined profile', () => {
    const bars = derivePreloadBars(
      [rule(leafNode(movingLeaf(20)))],
      [smaInstance(200)],
      defaultIndicators(),
    );

    expect(bars).toEqual(285);
  });

  it('is just the page margin when the only series operator is the unbounded Crossing', () => {
    const bars = derivePreloadBars([rule(leafNode(crossingLeaf()))], [], defaultIndicators());

    expect(bars).toEqual(64);
  });

  it('takes the deepest Moving leaf across nested AND/OR groups', () => {
    const nested: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [
        leafNode(movingLeaf(5)),
        { kind: ConditionNodeKind.Or, children: [leafNode(movingLeaf(30))] },
      ],
    };

    const bars = derivePreloadBars([rule(nested)], [], defaultIndicators());

    expect(bars).toEqual(95);
  });

  it('takes the max warmup across multiple indicator instances', () => {
    const bars = derivePreloadBars(
      [],
      [smaInstance(50, 'a'), smaInstance(200, 'b')],
      defaultIndicators(),
    );

    expect(bars).toEqual(264);
  });
});
