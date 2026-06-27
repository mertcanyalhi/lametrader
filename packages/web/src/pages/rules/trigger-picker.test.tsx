// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Period, TriggerKind } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TriggerPicker } from './trigger-picker';

function Harness({
  initialKind = TriggerKind.Once,
  initialPeriod = '' as Period | '',
  initialInterval = 60_000,
}: {
  initialKind?: TriggerKind;
  initialPeriod?: Period | '';
  initialInterval?: number;
}): ReactNode {
  const [kind, setKind] = useState<TriggerKind>(initialKind);
  const [period, setPeriod] = useState<Period | ''>(initialPeriod);
  const [intervalMs, setIntervalMs] = useState<number>(initialInterval);
  return (
    <Theme>
      <div data-testid="snapshot">{JSON.stringify({ kind, period, intervalMs })}</div>
      <TriggerPicker
        kind={kind}
        onKindChange={setKind}
        period={period}
        onPeriodChange={setPeriod}
        intervalMs={intervalMs}
        onIntervalMsChange={setIntervalMs}
        periodError={undefined}
      />
    </Theme>
  );
}

function snapshot(): { kind: TriggerKind; period: Period | ''; intervalMs: number } {
  return JSON.parse(screen.getByTestId('snapshot').textContent ?? 'null');
}

describe('TriggerPicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('hides the period and interval inputs when the kind is "Once"', () => {
    render(<Harness initialKind={TriggerKind.Once} />);
    expect({
      period: screen.queryByRole('combobox', { name: 'Trigger period' }),
      interval: screen.queryByRole('spinbutton', { name: 'Trigger interval (ms)' }),
    }).toEqual({ period: null, interval: null });
  });

  it('reveals the period dropdown when the kind is "Once per bar"', () => {
    render(<Harness initialKind={TriggerKind.OncePerBar} />);
    expect(screen.getByRole('combobox', { name: 'Trigger period' })).toBeInTheDocument();
  });

  it('reveals the interval ms input when the kind is "Once per interval"', () => {
    render(<Harness initialKind={TriggerKind.OncePerMinute} initialInterval={45_000} />);
    expect(screen.getByRole('spinbutton', { name: 'Trigger interval (ms)' })).toHaveValue(45_000);
  });

  it('updates the kind snapshot when the user picks a different dropdown option', async () => {
    render(<Harness initialKind={TriggerKind.Once} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Trigger' }));
    await user.click(screen.getByRole('option', { name: 'Once per bar close' }));

    expect(snapshot().kind).toEqual(TriggerKind.OncePerBarClose);
  });

  it('emits the picked period when the user chooses a bar size', async () => {
    render(<Harness initialKind={TriggerKind.OncePerBar} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Trigger period' }));
    await user.click(screen.getByRole('option', { name: '15m' }));

    expect(snapshot().period).toEqual(Period.FifteenMinutes);
  });
});
