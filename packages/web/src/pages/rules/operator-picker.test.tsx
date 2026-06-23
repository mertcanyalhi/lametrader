// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  type ConditionOperand,
  NumericOperator,
  OperandKind,
  StateOperator,
  StateValueType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { OperatorPicker, validOperatorsFor } from './operator-picker';

const NUMERIC_LEFT: ConditionOperand = {
  kind: OperandKind.CurrentValue,
  valueType: StateValueType.Number,
};
const NUMERIC_RIGHT: ConditionOperand = {
  kind: OperandKind.Literal,
  value: { type: StateValueType.Number, value: 100 },
};
const BOOL_LEFT: ConditionOperand = {
  kind: OperandKind.SymbolStateRef,
  key: 'armed',
  valueType: StateValueType.Bool,
};
const BOOL_RIGHT: ConditionOperand = {
  kind: OperandKind.Literal,
  value: { type: StateValueType.Bool, value: true },
};

function Harness({
  left,
  right,
  initial,
}: {
  left: ConditionOperand;
  right: ConditionOperand;
  initial: NumericOperator | StateOperator;
}): ReactNode {
  const [operator, setOperator] = useState<NumericOperator | StateOperator>(initial);
  return (
    <Theme>
      <OperatorPicker
        value={operator}
        onChange={setOperator}
        left={left}
        right={right}
        ariaLabel="Operator"
      />
    </Theme>
  );
}

describe('validOperatorsFor', () => {
  it('returns every numeric operator when both operands are numeric', () => {
    expect(validOperatorsFor(NUMERIC_LEFT, NUMERIC_RIGHT)).toEqual([
      NumericOperator.Gt,
      NumericOperator.Lt,
      NumericOperator.Gte,
      NumericOperator.Lte,
      NumericOperator.Eq,
      NumericOperator.Neq,
      NumericOperator.Crossing,
      NumericOperator.CrossingUp,
      NumericOperator.CrossingDown,
    ]);
  });

  it('returns only state operators when both operands are boolean', () => {
    expect(validOperatorsFor(BOOL_LEFT, BOOL_RIGHT)).toEqual([
      StateOperator.Equals,
      StateOperator.NotEquals,
      StateOperator.ChangesTo,
      StateOperator.ChangesFrom,
    ]);
  });

  it('returns an empty list when value types mismatch (no operator is legal)', () => {
    expect(validOperatorsFor(NUMERIC_LEFT, BOOL_RIGHT)).toEqual([]);
  });
});

describe('OperatorPicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('lists only numeric operators when both operands are numeric', async () => {
    render(<Harness left={NUMERIC_LEFT} right={NUMERIC_RIGHT} initial={NumericOperator.Gt} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Operator' }));

    expect({
      gt: screen.queryByRole('option', { name: '>' }) !== null,
      equalsState: screen.queryByRole('option', { name: '== (state)' }) !== null,
    }).toEqual({ gt: true, equalsState: false });
  });

  it('lists only state operators when both operands are boolean', async () => {
    render(<Harness left={BOOL_LEFT} right={BOOL_RIGHT} initial={StateOperator.Equals} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Operator' }));

    expect({
      gt: screen.queryByRole('option', { name: '>' }) !== null,
      equalsState: screen.queryByRole('option', { name: '== (state)' }) !== null,
      changesTo: screen.queryByRole('option', { name: 'changes to' }) !== null,
    }).toEqual({ gt: false, equalsState: true, changesTo: true });
  });
});
