import {
  type ConditionOperand,
  LeafConditionFamily,
  OperandKind,
  type StateLeafCondition,
  StateOperator,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
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
    if (operand.kind === OperandKind.Literal) return operand.value;
    if (operand.kind === OperandKind.SymbolStateRef) return params.leftLatest;
    return params.rightLatest;
  },
  resolvePrev: (operand) => {
    if (operand.kind === OperandKind.Literal) return operand.value;
    if (operand.kind === OperandKind.SymbolStateRef) return params.leftPrev;
    return null;
  },
  resolveSeries: () => EMPTY_SERIES,
});

const trendOperand: ConditionOperand = {
  kind: OperandKind.SymbolStateRef,
  key: 'trend',
  valueType: StateValueType.String,
};

const literalUp: ConditionOperand = {
  kind: OperandKind.Literal,
  value: { type: StateValueType.String, value: 'up' },
};

const stateLeaf = (operator: StateOperator): StateLeafCondition => ({
  family: LeafConditionFamily.State,
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
      equalsSame: evaluateState(stateLeaf(StateOperator.Equals), upUp),
      notEqualsSame: evaluateState(stateLeaf(StateOperator.NotEquals), upUp),
      changesToFires: evaluateState(stateLeaf(StateOperator.ChangesTo), downUp),
      changesToHolds: evaluateState(stateLeaf(StateOperator.ChangesTo), upUp),
      changesFromFires: evaluateState(stateLeaf(StateOperator.ChangesFrom), upDown),
      changesFromHolds: evaluateState(stateLeaf(StateOperator.ChangesFrom), upUp),
      changesToFromNull: evaluateState(stateLeaf(StateOperator.ChangesTo), nullUp),
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
