// @vitest-environment jsdom
import {
  ComparisonOperator,
  type ConditionOperand,
  CrossingOperator,
  LeafConditionFamily,
  OperandKind,
  type Operator,
  StateOperator,
  StateValueType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { OperandValueKind } from '../../lib/rule-form-schema';
import {
  legalFamiliesFor,
  legalOperatorsFor,
  OPERATOR_FAMILY_LABELS,
  OPERATOR_FAMILY_ORDER,
  OPERATOR_OPTIONS,
  OperatorPicker,
} from './operator-picker';

afterEach(() => {
  cleanup();
});

describe('legalFamiliesFor', () => {
  it('lists every family for a Numeric LHS', () => {
    expect(Array.from(legalFamiliesFor(OperandValueKind.Numeric))).toEqual([
      LeafConditionFamily.Comparison,
      LeafConditionFamily.Crossing,
      LeafConditionFamily.Channel,
      LeafConditionFamily.Moving,
      LeafConditionFamily.State,
    ]);
  });

  it('narrows to the State family for a Bool LHS', () => {
    expect(Array.from(legalFamiliesFor(OperandValueKind.Bool))).toEqual([
      LeafConditionFamily.State,
    ]);
  });

  it('narrows to the State family for a string-like LHS', () => {
    expect(Array.from(legalFamiliesFor(OperandValueKind.StringLike))).toEqual([
      LeafConditionFamily.State,
    ]);
  });
});

describe('OPERATOR_OPTIONS — collapsed Equals/NotEquals', () => {
  it('lists a single Equals entry (no separate state-equals dialect)', () => {
    const equalsLabels = OPERATOR_OPTIONS.filter((option) => option.label === 'equals').map(
      (option) => option.value,
    );
    expect(equalsLabels).toEqual([ComparisonOperator.Eq]);
  });

  it('lists a single NotEquals entry (no separate state-not-equals dialect)', () => {
    const neqLabels = OPERATOR_OPTIONS.filter((option) => option.label === 'not equals').map(
      (option) => option.value,
    );
    expect(neqLabels).toEqual([ComparisonOperator.Neq]);
  });

  it('drops StateOperator.Equals / StateOperator.NotEquals from the picker options entirely', () => {
    const stateOps = OPERATOR_OPTIONS.filter(
      (option) => option.family === LeafConditionFamily.State,
    ).map((option) => option.value);
    expect(stateOps).toEqual([StateOperator.ChangesTo, StateOperator.ChangesFrom]);
  });
});

describe('legalOperatorsFor — LHS-driven family dispatch for Equals/NotEquals', () => {
  it('returns Equals with family Comparison for a Numeric LHS (Price)', () => {
    const options = legalOperatorsFor({ kind: OperandKind.Price });
    const equals = options.find((option) => option.value === ComparisonOperator.Eq);
    expect(equals).toEqual({
      family: LeafConditionFamily.Comparison,
      value: ComparisonOperator.Eq,
      label: 'equals',
      icon: equals?.icon,
    });
  });

  it('returns Equals with family State for a SymbolStateRef LHS (state-ref dispatch)', () => {
    const options = legalOperatorsFor({
      kind: OperandKind.SymbolStateRef,
      key: 'trend',
      valueType: StateValueType.String,
    });
    const equals = options.find(
      (option) => option.value === StateOperator.Equals || option.value === ComparisonOperator.Eq,
    );
    expect(equals).toEqual({
      family: LeafConditionFamily.State,
      value: StateOperator.Equals,
      label: 'equals',
      icon: equals?.icon,
    });
  });

  it('returns NotEquals with family State for a GlobalStateRef LHS', () => {
    const options = legalOperatorsFor({
      kind: OperandKind.GlobalStateRef,
      key: 'regime',
      valueType: StateValueType.String,
    });
    const notEquals = options.find(
      (option) =>
        option.value === StateOperator.NotEquals || option.value === ComparisonOperator.Neq,
    );
    expect(notEquals).toEqual({
      family: LeafConditionFamily.State,
      value: StateOperator.NotEquals,
      label: 'not equals',
      icon: notEquals?.icon,
    });
  });

  it('exposes Equals/NotEquals + ChangesTo/ChangesFrom for a string-like indicator-ref LHS', () => {
    const options = legalOperatorsFor({
      kind: OperandKind.IndicatorRef,
      instanceId: 'sup-1',
      stateKey: 'phase',
      valueType: StateValueType.String,
    }).map((option) => option.value);
    expect({
      hasEquals: options.includes(StateOperator.Equals),
      hasNotEquals: options.includes(StateOperator.NotEquals),
      hasChangesTo: options.includes(StateOperator.ChangesTo),
      hasChangesFrom: options.includes(StateOperator.ChangesFrom),
      hasCompareEq: options.includes(ComparisonOperator.Eq),
    }).toEqual({
      hasEquals: true,
      hasNotEquals: true,
      hasChangesTo: true,
      hasChangesFrom: true,
      hasCompareEq: false,
    });
  });
});

describe('legalOperatorsFor', () => {
  it('exposes Crossing operators when the LHS is Price (numeric)', () => {
    const options = legalOperatorsFor({ kind: OperandKind.Price }).map((o) => o.value);
    expect(options.includes(CrossingOperator.Crossing)).toEqual(true);
  });

  it('hides Crossing operators when the LHS is a Bool indicator-ref', () => {
    const options = legalOperatorsFor({
      kind: OperandKind.IndicatorRef,
      instanceId: 'sup-1',
      stateKey: 'superTrendBuy',
      valueType: StateValueType.Bool,
    }).map((o) => o.value);
    expect(options.includes(CrossingOperator.Crossing)).toEqual(false);
    expect(options.includes(StateOperator.Equals)).toEqual(true);
  });
});

describe('OPERATOR_OPTIONS metadata', () => {
  it('attaches an icon component to every operator option', () => {
    const missingIcon = OPERATOR_OPTIONS.filter((option) => option.icon === undefined).map(
      (option) => option.value,
    );
    expect(missingIcon).toEqual([]);
  });
});

describe('OPERATOR_FAMILY_ORDER', () => {
  it('orders families in engine order (Comparison, Crossing, Channel, Moving, State)', () => {
    expect(OPERATOR_FAMILY_ORDER).toEqual([
      LeafConditionFamily.Comparison,
      LeafConditionFamily.Crossing,
      LeafConditionFamily.Channel,
      LeafConditionFamily.Moving,
      LeafConditionFamily.State,
    ]);
  });

  it('labels every family with a user-facing string', () => {
    expect(OPERATOR_FAMILY_LABELS).toEqual({
      [LeafConditionFamily.Comparison]: 'Comparison',
      [LeafConditionFamily.Crossing]: 'Crossing',
      [LeafConditionFamily.Channel]: 'Channel',
      [LeafConditionFamily.Moving]: 'Moving',
      [LeafConditionFamily.State]: 'State',
    });
  });
});

function PickerHarness({
  left = { kind: OperandKind.Price } as ConditionOperand,
  initial = ComparisonOperator.Gt as Operator,
}: {
  left?: ConditionOperand;
  initial?: Operator;
}): ReactNode {
  const [value, setValue] = useState<Operator>(initial);
  return (
    <Theme>
      <OperatorPicker
        value={value}
        left={left}
        onChange={({ operator }) => setValue(operator)}
        ariaLabel="Operator"
      />
    </Theme>
  );
}

describe('OperatorPicker — grouped + iconified rendering', () => {
  it('renders family-section labels in engine order when opened with a numeric LHS', async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);
    await user.click(screen.getByLabelText('Operator'));
    // Every engine-ordered family label must appear in the rendered content.
    expect(OPERATOR_FAMILY_ORDER.map((family) => OPERATOR_FAMILY_LABELS[family])).toEqual([
      'Comparison',
      'Crossing',
      'Channel',
      'Moving',
      'State',
    ]);
    // Radix renders `Select.Label` as plain text inside the listbox; assert each
    // label is on screen.
    for (const family of OPERATOR_FAMILY_ORDER) {
      expect(screen.getByText(OPERATOR_FAMILY_LABELS[family])).toBeDefined();
    }
  });

  it('renders an svg icon next to every operator option label', async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);
    await user.click(screen.getByLabelText('Operator'));
    const allItems = screen.queryAllByRole('option');
    expect(allItems.length > 0).toEqual(true);
    const allHaveIcons = allItems.every((item) => item.querySelector('svg') !== null);
    expect(allHaveIcons).toEqual(true);
  });
});
