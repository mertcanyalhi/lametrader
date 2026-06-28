import { RulesV2, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { ArraySeriesView } from '../indicator-series-store.js';
import type { SeriesView } from '../series.types.js';
import { evaluateState } from './state.js';

const EMPTY_SERIES: SeriesView = new ArraySeriesView([]);

/**
 * Minimal {@link EvaluationContext} keyed by operand kind for the State family.
 */
const fakeCtx = (params: {
  leftLatest: StateValue | null;
  leftPrev: StateValue | null;
  rightLatest: StateValue | null;
}): EvaluationContext => ({
  symbolId: 'BTC',
  resolveLatest: (operand) => {
    if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
    if (operand.kind === RulesV2.OperandKind.SymbolStateRef) return params.leftLatest;
    return params.rightLatest;
  },
  resolvePrev: (operand) => {
    if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
    if (operand.kind === RulesV2.OperandKind.SymbolStateRef) return params.leftPrev;
    return null;
  },
  resolveSeries: () => EMPTY_SERIES,
});

const trendOperand: RulesV2.ConditionOperand = {
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
  left: trendOperand,
  right: literalUp,
});

const up: StateValue = { type: StateValueType.String, value: 'up' };
const down: StateValue = { type: StateValueType.String, value: 'down' };

describe('evaluateState', () => {
  it('matches v1 semantics for Equals/NotEquals snapshot, ChangesTo (prev != right && current == right), ChangesFrom (prev == right && current != right); null is a distinct sentinel', () => {
    const upUp = fakeCtx({ leftLatest: up, leftPrev: up, rightLatest: up });
    const downUp = fakeCtx({ leftLatest: up, leftPrev: down, rightLatest: up });
    const upDown = fakeCtx({ leftLatest: down, leftPrev: up, rightLatest: up });
    const nullUp = fakeCtx({ leftLatest: up, leftPrev: null, rightLatest: up });
    expect({
      equalsSame: evaluateState(stateLeaf(RulesV2.StateOperator.Equals), upUp),
      notEqualsSame: evaluateState(stateLeaf(RulesV2.StateOperator.NotEquals), upUp),
      changesToFires: evaluateState(stateLeaf(RulesV2.StateOperator.ChangesTo), downUp),
      changesToHolds: evaluateState(stateLeaf(RulesV2.StateOperator.ChangesTo), upUp),
      changesFromFires: evaluateState(stateLeaf(RulesV2.StateOperator.ChangesFrom), upDown),
      changesFromHolds: evaluateState(stateLeaf(RulesV2.StateOperator.ChangesFrom), upUp),
      changesToFromNull: evaluateState(stateLeaf(RulesV2.StateOperator.ChangesTo), nullUp),
    }).toEqual({
      equalsSame: true,
      notEqualsSame: false,
      changesToFires: true,
      changesToHolds: false,
      changesFromFires: true,
      changesFromHolds: false,
      changesToFromNull: true,
    });
  });
});
