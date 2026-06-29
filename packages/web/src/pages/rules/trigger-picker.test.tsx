// @vitest-environment jsdom
import { Period, type Trigger, TriggerKind } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TriggerPicker } from './trigger-picker';

afterEach(() => {
  cleanup();
});

function Harness({ initial }: { initial: Trigger }): ReactNode {
  const [value, setValue] = useState<Trigger>(initial);
  return (
    <Theme>
      <TriggerPicker value={value} onChange={setValue} />
    </Theme>
  );
}

describe('TriggerPicker', () => {
  it('renders only the kind dropdown when EveryTime is selected (no period, no interval)', () => {
    render(<Harness initial={{ kind: TriggerKind.EveryTime }} />);
    expect(screen.queryByLabelText('Trigger period')).toEqual(null);
    expect(screen.queryByLabelText('Trigger interval ms')).toEqual(null);
  });

  it('surfaces a period picker for OncePerBar', () => {
    render(<Harness initial={{ kind: TriggerKind.OncePerBar, period: Period.OneHour }} />);
    expect(screen.getByLabelText('Trigger period')).toBeDefined();
    expect(screen.queryByLabelText('Trigger interval ms')).toEqual(null);
  });

  it('surfaces a period picker for OncePerBarClose', () => {
    render(<Harness initial={{ kind: TriggerKind.OncePerBarClose, period: Period.OneHour }} />);
    expect(screen.getByLabelText('Trigger period')).toBeDefined();
  });

  it('surfaces an intervalMs input for OncePerInterval', () => {
    render(<Harness initial={{ kind: TriggerKind.OncePerInterval, intervalMs: 60_000 }} />);
    expect(screen.getByLabelText('Trigger interval ms')).toBeDefined();
    expect(screen.queryByLabelText('Trigger period')).toEqual(null);
  });
});
