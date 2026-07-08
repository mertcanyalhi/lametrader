import {
  ActionKind,
  ChannelOperator,
  type ComparisonLeafCondition,
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  type CrossingLeafCondition,
  CrossingOperator,
  type IndicatorInstance,
  type LeafCondition,
  LeafConditionFamily,
  type MovingLeafCondition,
  MovingOperator,
  OperandKind,
  Period,
  PriceSource,
  type Profile,
  ProfileScope,
  type Rule,
  RuleScopeKind,
  type StateLeafCondition,
  StateOperator,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { defaultIndicators } from '../indicators/default-indicators.js';
import { deriveMaxLookback, operatorWalkDepth, roundToPage } from './derive-max-lookback.js';

/** The profile id every fixture rule belongs to. */
const PROFILE_ID = 'profile-1';

/** A minimal enabled profile carrying the given attached indicator instances. */
const profileWith = (indicators: IndicatorInstance[]): Profile => ({
  id: PROFILE_ID,
  name: 'lookback profile',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: 0,
  updatedAt: 0,
  indicators,
});

/** An attached SMA instance of `length` — its module warmup is `length`. */
const smaInstance = (id: string, length: number): IndicatorInstance => ({
  id,
  indicatorKey: 'sma',
  version: 1,
  inputs: { length, source: PriceSource.Close },
});

/** A minimal rule wrapping `condition` under a tick-cadence trigger. */
const ruleWith = (condition: ConditionNode): Rule => ({
  id: 'r1',
  profileId: PROFILE_ID,
  name: 'lookback rule',
  scope: { kind: RuleScopeKind.AllSymbols },
  condition,
  trigger: { kind: TriggerKind.EveryTime },
  expiration: null,
  actions: [
    {
      kind: ActionKind.SetSymbolState,
      key: 'hit',
      value: { type: StateValueType.Bool, value: true },
    },
  ],
  enabled: true,
  order: 1,
  createdAt: 0,
  updatedAt: 0,
});

/** Wrap a leaf into a single-leaf condition tree. */
const leafNode = (leaf: LeafCondition): ConditionNode => ({
  kind: ConditionNodeKind.Leaf,
  leaf,
});

/** A Moving leaf over the interval-pinned bar close. */
const movingCloseLeaf = (lookbackBars: number, interval: Period): MovingLeafCondition => ({
  family: LeafConditionFamily.Moving,
  operator: MovingOperator.MovingUp,
  left: { kind: OperandKind.Close },
  threshold: 1,
  lookbackBars,
  interval,
});

/** A Moving leaf over the interval-agnostic live price (no `interval`). */
const movingPriceLeaf = (lookbackBars: number): MovingLeafCondition => ({
  family: LeafConditionFamily.Moving,
  operator: MovingOperator.MovingUp,
  left: { kind: OperandKind.Price },
  threshold: 1,
  lookbackBars,
});

/** A Moving leaf walking an SMA indicator operand at `interval`. */
const movingIndicatorLeaf = (
  lookbackBars: number,
  interval: Period,
  instanceId: string,
): MovingLeafCondition => ({
  family: LeafConditionFamily.Moving,
  operator: MovingOperator.MovingUp,
  left: {
    kind: OperandKind.IndicatorRef,
    instanceId,
    stateKey: 'value',
    valueType: StateValueType.Number,
  },
  threshold: 1,
  lookbackBars,
  interval,
});

/** A snapshot Comparison leaf on the interval-pinned bar close. */
const comparisonCloseLeaf = (interval: Period): ComparisonLeafCondition => ({
  family: LeafConditionFamily.Comparison,
  operator: ComparisonOperator.Gt,
  left: { kind: OperandKind.Close },
  right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
  interval,
});

/** A snapshot State leaf on a symbol-state key. */
const stateLeaf = (): StateLeafCondition => ({
  family: LeafConditionFamily.State,
  operator: StateOperator.Equals,
  left: { kind: OperandKind.SymbolStateRef, key: 'flag', valueType: StateValueType.Bool },
  right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
});

/** A Crossing leaf — unbounded baseline walk, never config-derivable. */
const crossingLeaf = (): CrossingLeafCondition => ({
  family: LeafConditionFamily.Crossing,
  operator: CrossingOperator.CrossingUp,
  left: { kind: OperandKind.Close },
  right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
  interval: Period.OneHour,
});

/** A Channel leaf — unbounded baseline walk, never config-derivable. */
const channelLeaf = (): LeafCondition => ({
  family: LeafConditionFamily.Channel,
  operator: ChannelOperator.EnteringChannel,
  left: { kind: OperandKind.Close },
  lower: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 90 } },
  upper: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 110 } },
  interval: Period.OneHour,
});

describe('roundToPage', () => {
  it('rounds a raw bar count up to a whole page plus one page of safety margin', () => {
    expect(roundToPage(204)).toBe(320);
    expect(roundToPage(64)).toBe(128);
    expect(roundToPage(1)).toBe(128);
    expect(roundToPage(0)).toBe(64);
  });
});

describe('operatorWalkDepth', () => {
  it('maps each leaf family to its config-derivable backward-walk depth', () => {
    expect(operatorWalkDepth(movingCloseLeaf(20, Period.OneHour))).toBe(21);
    expect(operatorWalkDepth(comparisonCloseLeaf(Period.OneHour))).toBe(1);
    expect(operatorWalkDepth(stateLeaf())).toBe(1);
    expect(operatorWalkDepth(crossingLeaf())).toBeUndefined();
    expect(operatorWalkDepth(channelLeaf())).toBeUndefined();
  });
});

describe('deriveMaxLookback', () => {
  it('sizes every active period at the rounded max warmup when only indicators contribute', () => {
    const profile = profileWith([smaInstance('sma-14', 14), smaInstance('sma-100', 100)]);
    const result = deriveMaxLookback(profile, [], defaultIndicators(), [
      Period.OneMinute,
      Period.OneHour,
    ]);
    expect(result).toEqual(
      new Map([
        [Period.OneMinute, 192],
        [Period.OneHour, 192],
      ]),
    );
  });

  it('sizes only the pinned interval when a lone Moving leaf contributes', () => {
    const profile = profileWith([]);
    const rules = [ruleWith(leafNode(movingCloseLeaf(20, Period.OneHour)))];
    const result = deriveMaxLookback(profile, rules, defaultIndicators(), [
      Period.OneMinute,
      Period.OneHour,
    ]);
    expect(result).toEqual(new Map([[Period.OneHour, 128]]));
  });

  it('compounds the max walk depth with the max warmup per period before rounding', () => {
    const profile = profileWith([smaInstance('sma-14', 14), smaInstance('sma-100', 100)]);
    const rules = [
      ruleWith({
        kind: ConditionNodeKind.And,
        children: [
          leafNode(movingCloseLeaf(150, Period.OneHour)),
          leafNode(movingCloseLeaf(20, Period.OneHour)),
        ],
      }),
    ];
    const result = deriveMaxLookback(profile, rules, defaultIndicators(), [
      Period.OneMinute,
      Period.OneHour,
    ]);
    expect(result).toEqual(
      new Map([
        [Period.OneMinute, 192],
        [Period.OneHour, 320],
      ]),
    );
  });

  it('reproduces the design compounding example: SMA-200 under Moving(3) on 1h rounds to 320', () => {
    const profile = profileWith([smaInstance('sma-200', 200)]);
    const rules = [ruleWith(leafNode(movingIndicatorLeaf(3, Period.OneHour, 'sma-200')))];
    const result = deriveMaxLookback(profile, rules, defaultIndicators(), [Period.OneHour]);
    expect(result).toEqual(new Map([[Period.OneHour, 320]]));
  });

  it('resolves an interval-less leaf against every active period', () => {
    const profile = profileWith([]);
    const rules = [ruleWith(leafNode(movingPriceLeaf(20)))];
    const result = deriveMaxLookback(profile, rules, defaultIndicators(), [
      Period.OneMinute,
      Period.OneHour,
    ]);
    expect(result).toEqual(
      new Map([
        [Period.OneMinute, 128],
        [Period.OneHour, 128],
      ]),
    );
  });

  it('returns undefined when a rule contains a Crossing leaf', () => {
    const profile = profileWith([smaInstance('sma-14', 14)]);
    const rules = [ruleWith(leafNode(crossingLeaf()))];
    expect(
      deriveMaxLookback(profile, rules, defaultIndicators(), [Period.OneHour]),
    ).toBeUndefined();
  });

  it('returns undefined when a rule contains a Channel leaf', () => {
    const profile = profileWith([smaInstance('sma-14', 14)]);
    const rules = [ruleWith(leafNode(channelLeaf()))];
    expect(
      deriveMaxLookback(profile, rules, defaultIndicators(), [Period.OneHour]),
    ).toBeUndefined();
  });
});
