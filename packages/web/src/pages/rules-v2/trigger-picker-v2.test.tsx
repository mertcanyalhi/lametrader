// @vitest-environment jsdom
import { Period, RulesV2 } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TriggerPickerV2 } from './trigger-picker-v2';

afterEach(() => {
  cleanup();
});

function Harness({ initial }: { initial: RulesV2.Trigger }): ReactNode {
  const [value, setValue] = useState<RulesV2.Trigger>(initial);
  return (
    <Theme>
      <TriggerPickerV2 value={value} onChange={setValue} />
    </Theme>
  );
}

describe('TriggerPickerV2', () => {
  it('renders only the kind dropdown when EveryTime is selected (no period, no interval)', () => {
    render(<Harness initial={{ kind: RulesV2.TriggerKind.EveryTime }} />);
    expect(screen.queryByLabelText('Trigger period')).toEqual(null);
    expect(screen.queryByLabelText('Trigger interval ms')).toEqual(null);
  });

  it('surfaces a period picker for OncePerBar', () => {
    render(<Harness initial={{ kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneHour }} />);
    expect(screen.getByLabelText('Trigger period')).toBeDefined();
    expect(screen.queryByLabelText('Trigger interval ms')).toEqual(null);
  });

  it('surfaces a period picker for OncePerBarClose', () => {
    render(
      <Harness initial={{ kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.OneHour }} />,
    );
    expect(screen.getByLabelText('Trigger period')).toBeDefined();
  });

  it('surfaces an intervalMs input for OncePerInterval', () => {
    render(<Harness initial={{ kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 }} />);
    expect(screen.getByLabelText('Trigger interval ms')).toBeDefined();
    expect(screen.queryByLabelText('Trigger period')).toEqual(null);
  });
});
