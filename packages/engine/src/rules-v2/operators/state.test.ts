import { Period, RulesV2, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationLookups } from '../evaluation-context.types.js';
import { evaluateState } from './state.js';

const fakeLookups = (partial: Partial<EvaluationLookups> = {}): EvaluationLookups => ({
  latestPrice: () => null,
  latestOhlcv: () => null,
  latestIndicator: () => null,
  latestSymbolState: () => null,
  latestGlobalState: () => null,
  prevIndicator: () => null,
  prevSymbolState: () => null,
  prevGlobalState: () => null,
  priceSeries: () => null,
  barSeries: () => null,
  indicatorSeries: () => null,
  ...partial,
});

const tickEvent: RulesV2.EvaluationTriggerEvent = {
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts: 1_000,
  symbolId: 'BTC',
  price: 100,
};

const buildCtx = (lookups: EvaluationLookups) =>
  buildEvaluationContext({
    event: tickEvent,
    profileId: 'p1',
    symbolId: 'BTC',
    lookups,
    defaultPeriod: Period.OneMinute,
  });

const trendStateOperand: RulesV2.ConditionOperand = {
  kind: RulesV2.OperandKind.SymbolStateRef,
  key: 'trend',
  valueType: StateValueType.String,
};

const literalUp: RulesV2.ConditionOperand = {
  kind: RulesV2.OperandKind.Literal,
  value: { type: StateValueType.String, value: 'up' },
};

const stateLeaf = (operator: RulesV2.StateOperator): RulesV2.StateLeafCondition => ({
  family: RulesV2.LeafConditionFamily.State,
  operator,
  left: trendStateOperand,
  right: literalUp,
});

describe('evaluateState', () => {
  it('matches v1 semantics: Equals returns true on same-type same-value; NotEquals returns false on same-type same-value; ChangesTo fires when prev != right and current == right; ChangesFrom fires when prev == right and current != right; null is a distinct sentinel', () => {
    const upUp = buildCtx(
      fakeLookups({
        latestSymbolState: () =>
          ({ type: StateValueType.String, value: 'up' }) satisfies StateValue,
        prevSymbolState: () => ({ type: StateValueType.String, value: 'up' }) satisfies StateValue,
      }),
    );
    const downUp = buildCtx(
      fakeLookups({
        latestSymbolState: () =>
          ({ type: StateValueType.String, value: 'up' }) satisfies StateValue,
        prevSymbolState: () =>
          ({ type: StateValueType.String, value: 'down' }) satisfies StateValue,
      }),
    );
    const upDown = buildCtx(
      fakeLookups({
        latestSymbolState: () =>
          ({ type: StateValueType.String, value: 'down' }) satisfies StateValue,
        prevSymbolState: () => ({ type: StateValueType.String, value: 'up' }) satisfies StateValue,
      }),
    );
    const nullUp = buildCtx(
      fakeLookups({
        latestSymbolState: () =>
          ({ type: StateValueType.String, value: 'up' }) satisfies StateValue,
        prevSymbolState: () => null,
      }),
    );
    expect(evaluateState(stateLeaf(RulesV2.StateOperator.Equals), upUp)).toBe(true);
    expect(evaluateState(stateLeaf(RulesV2.StateOperator.NotEquals), upUp)).toBe(false);
    expect(evaluateState(stateLeaf(RulesV2.StateOperator.ChangesTo), downUp)).toBe(true);
    expect(evaluateState(stateLeaf(RulesV2.StateOperator.ChangesTo), upUp)).toBe(false);
    expect(evaluateState(stateLeaf(RulesV2.StateOperator.ChangesFrom), upDown)).toBe(true);
    expect(evaluateState(stateLeaf(RulesV2.StateOperator.ChangesFrom), upUp)).toBe(false);
    expect(evaluateState(stateLeaf(RulesV2.StateOperator.ChangesTo), nullUp)).toBe(true);
  });
});
