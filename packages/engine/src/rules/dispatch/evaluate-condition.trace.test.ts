import {
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  LeafConditionFamily,
  OperandKind,
  StateOperator,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import { afterEach, describe, expect, it } from 'vitest';

import { _resetLogRoot, _resetLogScopes } from '../../log.js';
import type { EvaluationContext } from '../evaluation-context.types.js';
import type { SeriesView } from '../series.types.js';
import { evaluateCondition } from './evaluate-condition.js';

/**
 * Empty series — operators only used here need `resolveLatest` /
 * `resolvePrev`.
 */
const EMPTY_SERIES: SeriesView = {
  length: 0,
  backwardWalk: () => [].values(),
  asOf: () => null,
};

/**
 * Trivial context — Price = 120, SymbolStateRef "trend" = "up" (prev "down"),
 * literals echo their value.
 */
const TRIVIAL_CTX: EvaluationContext = {
  symbolId: 'AAPL',
  resolveLatest(operand) {
    if (operand.kind === OperandKind.Literal) return operand.value;
    if (operand.kind === OperandKind.Price) return { type: StateValueType.Number, value: 120 };
    if (operand.kind === OperandKind.SymbolStateRef) {
      return { type: StateValueType.String, value: 'up' };
    }
    return null;
  },
  resolvePrev(operand) {
    if (operand.kind === OperandKind.Literal) return operand.value;
    if (operand.kind === OperandKind.SymbolStateRef) {
      return { type: StateValueType.String, value: 'down' };
    }
    return null;
  },
  resolveSeries: () => EMPTY_SERIES,
};

/** Parse one captured Pino line into the structured record. */
function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line);
}

describe('evaluateCondition trace', () => {
  afterEach(() => {
    _resetLogRoot();
    _resetLogScopes([]);
  });

  it('emits a leaf_decision trace under engine.rules.operators for a Comparison leaf with operand kinds, values, and result', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.operators', level: 'trace' }]);
    const literal100: StateValue = { type: StateValueType.Number, value: 100 };
    const node: ConditionNode = {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: { kind: OperandKind.Price },
        right: { kind: OperandKind.Literal, value: literal100 },
      },
    };

    evaluateCondition(node, TRIVIAL_CTX);

    expect(records).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.operators',
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        leftKind: OperandKind.Price,
        leftValue: { type: StateValueType.Number, value: 120 },
        leftPrev: null,
        rightKind: OperandKind.Literal,
        rightValue: { type: StateValueType.Number, value: 100 },
        rightPrev: { type: StateValueType.Number, value: 100 },
        result: true,
        msg: 'leaf_decision',
      },
    ]);
  });

  it('emits a leaf_decision trace for a State leaf carrying leftPrev (the v1 leaf_decision payload survives)', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.operators', level: 'trace' }]);
    const node: ConditionNode = {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.State,
        operator: StateOperator.ChangesTo,
        left: {
          kind: OperandKind.SymbolStateRef,
          key: 'trend',
          valueType: StateValueType.String,
        },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.String, value: 'up' },
        },
      },
    };

    evaluateCondition(node, TRIVIAL_CTX);

    expect(records).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.operators',
        family: LeafConditionFamily.State,
        operator: StateOperator.ChangesTo,
        leftKind: OperandKind.SymbolStateRef,
        leftValue: { type: StateValueType.String, value: 'up' },
        leftPrev: { type: StateValueType.String, value: 'down' },
        rightKind: OperandKind.Literal,
        rightValue: { type: StateValueType.String, value: 'up' },
        rightPrev: { type: StateValueType.String, value: 'up' },
        result: true,
        msg: 'leaf_decision',
      },
    ]);
  });

  it('does not emit any leaf_decision record when the operators scope is not enabled', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(parseRecord(line));
      },
    });
    // Default global level is `info`; trace records are silenced.
    const node: ConditionNode = {
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
    };

    evaluateCondition(node, TRIVIAL_CTX);

    expect(records).toEqual([]);
  });
});
