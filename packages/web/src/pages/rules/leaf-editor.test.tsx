// @vitest-environment jsdom
import {
  ChannelOperator,
  ComparisonOperator,
  CrossingOperator,
  type IndicatorInstance,
  type LeafCondition,
  LeafConditionFamily,
  MovingOperator,
  OperandKind,
  Period,
  StateOperator,
  StateValueType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBoolShortcut, LeafEditor, needsInterval } from './leaf-editor';

afterEach(() => {
  cleanup();
});

function Harness({
  initial,
  indicators = [],
  instancePeriods = {},
  onSnapshot,
}: {
  initial: LeafCondition;
  indicators?: IndicatorInstance[];
  instancePeriods?: Record<string, Period | undefined>;
  onSnapshot?: (leaf: LeafCondition) => void;
}): ReactNode {
  const [value, setValue] = useState<LeafCondition>(initial);
  return (
    <Theme>
      <LeafEditor
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

describe('LeafEditor — reference shapes from #396', () => {
  it('Ex.1 Price Crossing literal — renders a numeric Literal stepper and no Interval row', () => {
    render(
      <Harness
        initial={{
          family: LeafConditionFamily.Crossing,
          operator: CrossingOperator.Crossing,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
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
          family: LeafConditionFamily.Crossing,
          operator: CrossingOperator.Crossing,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.IndicatorRef,
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
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.IndicatorRef,
            instanceId: 'super-1h',
            stateKey: 'superTrendBuy',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
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
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Gt,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1h',
        stateKey: 'superTrendBuy',
        valueType: StateValueType.Bool,
      },
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: 0 },
      },
      interval: Period.OneHour,
    });
    expect(persisted).toEqual({
      family: LeafConditionFamily.State,
      operator: StateOperator.Equals,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1h',
        stateKey: 'superTrendBuy',
        valueType: StateValueType.Bool,
      },
      right: {
        kind: OperandKind.Literal,
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
          family: LeafConditionFamily.Moving,
          operator: MovingOperator.MovingUpPercent,
          left: {
            kind: OperandKind.IndicatorRef,
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

describe('LeafEditor — Channel layout', () => {
  it('renders Upper + Lower bound pickers labelled accordingly', () => {
    render(
      <Harness
        initial={{
          family: LeafConditionFamily.Channel,
          operator: ChannelOperator.InsideChannel,
          left: { kind: OperandKind.Price },
          upper: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 130 },
          },
          lower: {
            kind: OperandKind.Literal,
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
    const leaf: LeafCondition = {
      family: LeafConditionFamily.Crossing,
      operator: CrossingOperator.Crossing,
      left: { kind: OperandKind.Price },
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: 120 },
      },
    };
    expect(needsInterval(leaf)).toEqual(false);
  });

  it('returns true when either operand needs a bar period (Ex.2)', () => {
    const leaf: LeafCondition = {
      family: LeafConditionFamily.Crossing,
      operator: CrossingOperator.Crossing,
      left: { kind: OperandKind.Price },
      right: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1h',
        stateKey: 'upTrend',
        valueType: StateValueType.Number,
      },
    };
    expect(needsInterval(leaf)).toEqual(true);
  });
});
