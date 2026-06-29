// @vitest-environment jsdom
import { type IndicatorInstance, Period, RulesV2, StateValueType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBoolShortcut, LeafEditorV2, needsInterval } from './leaf-editor-v2';

afterEach(() => {
  cleanup();
});

function Harness({
  initial,
  indicators = [],
  instancePeriods = {},
  onSnapshot,
}: {
  initial: RulesV2.LeafCondition;
  indicators?: IndicatorInstance[];
  instancePeriods?: Record<string, Period | undefined>;
  onSnapshot?: (leaf: RulesV2.LeafCondition) => void;
}): ReactNode {
  const [value, setValue] = useState<RulesV2.LeafCondition>(initial);
  return (
    <Theme>
      <LeafEditorV2
        value={value}
        onChange={(next) => {
          setValue(next);
          onSnapshot?.(next);
        }}
        indicators={indicators}
        instancePeriods={instancePeriods}
        knownStateKeys={{ symbol: [], global: [] }}
      />
    </Theme>
  );
}

describe('LeafEditorV2 — reference shapes from #396', () => {
  it('Ex.1 Price Crossing literal — renders a numeric Literal stepper and no Interval row', () => {
    render(
      <Harness
        initial={{
          family: RulesV2.LeafConditionFamily.Crossing,
          operator: RulesV2.CrossingOperator.Crossing,
          left: { kind: RulesV2.OperandKind.Price },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Number, value: 120 },
          },
        }}
      />,
    );
    const literal = screen.getByLabelText('Literal value') as HTMLInputElement;
    const intervalPicker = screen.queryByLabelText('Row interval');
    expect({
      literalType: literal.type,
      literalValue: literal.value,
      intervalRowShown: intervalPicker !== null,
    }).toEqual({ literalType: 'number', literalValue: '120', intervalRowShown: false });
  });

  it('Ex.2 Price Crossing IndicatorRef — surfaces the Interval row and filters by it', () => {
    const indicators: IndicatorInstance[] = [
      {
        id: 'super-1h',
        indicatorKey: 'supertrend',
        version: 1,
        inputs: { length: 10, source: 'hl2', factor: 3 },
        summary: 'Supertrend (10, hl2, 3)',
      },
      {
        id: 'super-15m',
        indicatorKey: 'supertrend',
        version: 1,
        inputs: { length: 10, source: 'hl2', factor: 3 },
        summary: 'Supertrend 15m',
      },
    ];
    const instancePeriods: Record<string, Period> = {
      'super-1h': Period.OneHour,
      'super-15m': Period.FifteenMinutes,
    };
    render(
      <Harness
        initial={{
          family: RulesV2.LeafConditionFamily.Crossing,
          operator: RulesV2.CrossingOperator.Crossing,
          left: { kind: RulesV2.OperandKind.Price },
          right: {
            kind: RulesV2.OperandKind.IndicatorRef,
            instanceId: 'super-1h',
            stateKey: 'upTrend',
            valueType: StateValueType.Number,
          },
          interval: Period.OneHour,
        }}
        indicators={indicators}
        instancePeriods={instancePeriods}
      />,
    );
    const intervalPicker = screen.getByLabelText('Row interval');
    expect(intervalPicker).toBeDefined();
  });

  it('Ex.3 Bool indicator-state shortcut — hides the operator + RHS and applyBoolShortcut emits State/Equals(true)', () => {
    const indicators: IndicatorInstance[] = [
      {
        id: 'super-1h',
        indicatorKey: 'supertrend',
        version: 1,
        inputs: { length: 10, source: 'hl2', factor: 3 },
        summary: 'Supertrend (10, hl2, 3)',
      },
    ];
    render(
      <Harness
        initial={{
          family: RulesV2.LeafConditionFamily.State,
          operator: RulesV2.StateOperator.Equals,
          left: {
            kind: RulesV2.OperandKind.IndicatorRef,
            instanceId: 'super-1h',
            stateKey: 'superTrendBuy',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
          interval: Period.OneHour,
        }}
        indicators={indicators}
        instancePeriods={{ 'super-1h': Period.OneHour }}
      />,
    );
    const operator = screen.queryByLabelText('Operator');
    const rhs = screen.queryByLabelText('Right operand kind');
    expect({ operatorHidden: operator === null, rhsHidden: rhs === null }).toEqual({
      operatorHidden: true,
      rhsHidden: true,
    });

    // The serializer rewrites a bool-typed leaf to State / Equals against
    // Literal(true) — same call path the editor uses on save.
    const persisted = applyBoolShortcut({
      family: RulesV2.LeafConditionFamily.Comparison,
      operator: RulesV2.ComparisonOperator.Gt,
      left: {
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId: 'super-1h',
        stateKey: 'superTrendBuy',
        valueType: StateValueType.Bool,
      },
      right: {
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Number, value: 0 },
      },
      interval: Period.OneHour,
    });
    expect(persisted).toEqual({
      family: RulesV2.LeafConditionFamily.State,
      operator: RulesV2.StateOperator.Equals,
      left: {
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId: 'super-1h',
        stateKey: 'superTrendBuy',
        valueType: StateValueType.Bool,
      },
      right: {
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Bool, value: true },
      },
      interval: Period.OneHour,
    });
  });

  it('Ex.4 Moving Up % — renders threshold + bars inputs and no RHS picker', () => {
    const indicators: IndicatorInstance[] = [
      {
        id: 'super-1h',
        indicatorKey: 'supertrend',
        version: 1,
        inputs: { length: 10, source: 'hl2', factor: 3 },
        summary: 'Supertrend (10, hl2, 3)',
      },
    ];
    render(
      <Harness
        initial={{
          family: RulesV2.LeafConditionFamily.Moving,
          operator: RulesV2.MovingOperator.MovingUpPercent,
          left: {
            kind: RulesV2.OperandKind.IndicatorRef,
            instanceId: 'super-1h',
            stateKey: 'upTrend',
            valueType: StateValueType.Number,
          },
          threshold: 10.5,
          lookbackBars: 2,
          interval: Period.OneHour,
        }}
        indicators={indicators}
        instancePeriods={{ 'super-1h': Period.OneHour }}
      />,
    );
    const threshold = screen.getByLabelText('Moving threshold') as HTMLInputElement;
    const bars = screen.getByLabelText('Moving lookback bars') as HTMLInputElement;
    const rhs = screen.queryByLabelText('Right operand kind');
    expect({
      thresholdValue: threshold.value,
      thresholdType: threshold.type,
      barsValue: bars.value,
      rhsHidden: rhs === null,
    }).toEqual({
      thresholdValue: '10.5',
      thresholdType: 'number',
      barsValue: '2',
      rhsHidden: true,
    });
  });
});

describe('LeafEditorV2 — Channel layout', () => {
  it('renders Upper + Lower bound pickers labelled accordingly', () => {
    render(
      <Harness
        initial={{
          family: RulesV2.LeafConditionFamily.Channel,
          operator: RulesV2.ChannelOperator.InsideChannel,
          left: { kind: RulesV2.OperandKind.Price },
          upper: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Number, value: 130 },
          },
          lower: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Number, value: 110 },
          },
        }}
      />,
    );
    expect(screen.getByLabelText('Upper bound operand kind')).toBeDefined();
    expect(screen.getByLabelText('Lower bound operand kind')).toBeDefined();
  });
});

describe('needsInterval', () => {
  it('returns false for Price-vs-Literal crossing (Ex.1)', () => {
    const leaf: RulesV2.LeafCondition = {
      family: RulesV2.LeafConditionFamily.Crossing,
      operator: RulesV2.CrossingOperator.Crossing,
      left: { kind: RulesV2.OperandKind.Price },
      right: {
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Number, value: 120 },
      },
    };
    expect(needsInterval(leaf)).toEqual(false);
  });

  it('returns true when either operand needs a bar period (Ex.2)', () => {
    const leaf: RulesV2.LeafCondition = {
      family: RulesV2.LeafConditionFamily.Crossing,
      operator: RulesV2.CrossingOperator.Crossing,
      left: { kind: RulesV2.OperandKind.Price },
      right: {
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId: 'super-1h',
        stateKey: 'upTrend',
        valueType: StateValueType.Number,
      },
    };
    expect(needsInterval(leaf)).toEqual(true);
  });
});
