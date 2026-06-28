// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { yupResolver } from '@hookform/resolvers/yup';
import { Period, type Trigger, TriggerKind } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it } from 'vitest';
import * as yup from 'yup';
import {
  DEFAULT_TRIGGER_INTERVAL_MS,
  isBarBasedTrigger,
  TriggerFormSection,
  triggerFormDefaults,
  triggerFormFields,
  triggerFromForm,
  triggerToForm,
} from './trigger-form-section';

const triggerSchema = yup.object({ ...triggerFormFields });

/** RHF host so the section renders standalone, with a submit button to flush validation. */
function Host({
  initial = triggerFormDefaults,
  onSubmit = () => {},
}: {
  initial?: typeof triggerFormDefaults;
  onSubmit?: (values: typeof triggerFormDefaults) => void;
}): ReactNode {
  const { control, handleSubmit } = useForm({
    resolver: yupResolver(triggerSchema),
    defaultValues: initial,
    mode: 'onSubmit',
  });
  return (
    <Theme>
      {/* biome-ignore lint/suspicious/noExplicitAny: control is shape-compatible with RuleFormValues for the trigger slice */}
      <form onSubmit={handleSubmit((values) => onSubmit(values as typeof triggerFormDefaults))}>
        <TriggerFormSection control={control as any} />
        <button type="submit">Submit</button>
      </form>
    </Theme>
  );
}

describe('TriggerFormSection — conditional inputs', () => {
  afterEach(cleanup);

  it('renders only the kind dropdown when triggerKind is Once', () => {
    render(<Host />);
    expect({
      period: screen.queryByRole('combobox', { name: 'Trigger period' }),
      interval: screen.queryByRole('spinbutton', { name: 'Trigger interval (ms)' }),
    }).toEqual({ period: null, interval: null });
  });

  it('renders the period dropdown when triggerKind is OncePerBar', () => {
    render(
      <Host
        initial={{
          ...triggerFormDefaults,
          triggerKind: TriggerKind.OncePerBar,
        }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Trigger period' })).toBeInTheDocument();
  });

  it('renders the period dropdown when triggerKind is OncePerBarClose', () => {
    render(
      <Host
        initial={{
          ...triggerFormDefaults,
          triggerKind: TriggerKind.OncePerBarClose,
        }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Trigger period' })).toBeInTheDocument();
  });

  it('renders the interval input when triggerKind is OncePerMinute', () => {
    render(
      <Host
        initial={{
          ...triggerFormDefaults,
          triggerKind: TriggerKind.OncePerMinute,
          triggerIntervalMs: 45_000,
        }}
      />,
    );
    expect(screen.getByRole('spinbutton', { name: 'Trigger interval (ms)' })).toHaveValue(45_000);
  });
});

describe('TriggerFormSection — schema (via Host submit)', () => {
  afterEach(cleanup);

  it('reports a "Trigger period is required" error on submit when triggerKind is OncePerBar and triggerPeriod is empty', async () => {
    render(
      <Host
        initial={{
          ...triggerFormDefaults,
          triggerKind: TriggerKind.OncePerBar,
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Trigger period is required.');
  });

  it('reports the same error for OncePerBarClose', async () => {
    render(
      <Host
        initial={{
          ...triggerFormDefaults,
          triggerKind: TriggerKind.OncePerBarClose,
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Trigger period is required.');
  });

  it('updates the kind when the user picks a different dropdown option', async () => {
    render(<Host />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Trigger' }));
    await user.click(screen.getByRole('option', { name: 'Once per bar close' }));

    expect(screen.getByRole('combobox', { name: 'Trigger period' })).toBeInTheDocument();
  });
});

describe('isBarBasedTrigger', () => {
  it('returns true for OncePerBar and OncePerBarClose', () => {
    expect(isBarBasedTrigger(TriggerKind.OncePerBar)).toBe(true);
    expect(isBarBasedTrigger(TriggerKind.OncePerBarClose)).toBe(true);
  });

  it('returns false for Once and OncePerMinute', () => {
    expect(isBarBasedTrigger(TriggerKind.Once)).toBe(false);
    expect(isBarBasedTrigger(TriggerKind.OncePerMinute)).toBe(false);
  });
});

describe('triggerFromForm', () => {
  it('builds a Once trigger', () => {
    expect(
      triggerFromForm({
        triggerKind: TriggerKind.Once,
        triggerPeriod: '',
        triggerIntervalMs: 60_000,
      }),
    ).toEqual({ kind: TriggerKind.Once });
  });

  it('builds a OncePerBar trigger with the period', () => {
    expect(
      triggerFromForm({
        triggerKind: TriggerKind.OncePerBar,
        triggerPeriod: Period.FifteenMinutes,
        triggerIntervalMs: 60_000,
      }),
    ).toEqual({ kind: TriggerKind.OncePerBar, period: Period.FifteenMinutes });
  });

  it('builds a OncePerBarClose trigger with the period', () => {
    expect(
      triggerFromForm({
        triggerKind: TriggerKind.OncePerBarClose,
        triggerPeriod: Period.OneHour,
        triggerIntervalMs: 60_000,
      }),
    ).toEqual({ kind: TriggerKind.OncePerBarClose, period: Period.OneHour });
  });

  it('builds a OncePerMinute trigger with the intervalMs', () => {
    expect(
      triggerFromForm({
        triggerKind: TriggerKind.OncePerMinute,
        triggerPeriod: '',
        triggerIntervalMs: 30_000,
      }),
    ).toEqual({ kind: TriggerKind.OncePerMinute, intervalMs: 30_000 });
  });
});

describe('triggerToForm', () => {
  it('extracts the period for a OncePerBar trigger and defaults the intervalMs', () => {
    const trigger: Trigger = { kind: TriggerKind.OncePerBar, period: Period.FifteenMinutes };
    expect(triggerToForm(trigger)).toEqual({
      triggerKind: TriggerKind.OncePerBar,
      triggerPeriod: Period.FifteenMinutes,
      triggerIntervalMs: DEFAULT_TRIGGER_INTERVAL_MS,
    });
  });

  it('preserves the intervalMs for a OncePerMinute trigger and blanks the period', () => {
    const trigger: Trigger = { kind: TriggerKind.OncePerMinute, intervalMs: 45_000 };
    expect(triggerToForm(trigger)).toEqual({
      triggerKind: TriggerKind.OncePerMinute,
      triggerPeriod: '',
      triggerIntervalMs: 45_000,
    });
  });

  it('blanks the period for a Once trigger', () => {
    const trigger: Trigger = { kind: TriggerKind.Once };
    expect(triggerToForm(trigger)).toEqual({
      triggerKind: TriggerKind.Once,
      triggerPeriod: '',
      triggerIntervalMs: DEFAULT_TRIGGER_INTERVAL_MS,
    });
  });
});
