// @vitest-environment jsdom
import { FieldType, PriceSource, type StateFieldDescriptor } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndicatorInputsForm } from './indicator-inputs-form.js';

/** A `state` array stub — the form only reads `inputs`, but the type wants something. */
const STATE_EMPTY: StateFieldDescriptor[] = [];

describe('IndicatorInputsForm', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a Number descriptor as a number input with min/max/step/defaultValue from the descriptor', () => {
    render(
      <Theme>
        <IndicatorInputsForm
          inputs={[
            {
              type: FieldType.Number,
              key: 'length',
              label: 'Length',
              integer: true,
              min: 1,
              max: 1_000,
              step: 1,
              default: 14,
            },
          ]}
          state={STATE_EMPTY}
          initialValues={{}}
          onSubmit={() => {}}
        />
      </Theme>,
    );

    const input = screen.getByRole('spinbutton', { name: 'Length' }) as HTMLInputElement;
    expect({
      type: input.type,
      min: input.min,
      max: input.max,
      step: input.step,
      defaultValue: input.defaultValue,
    }).toEqual({ type: 'number', min: '1', max: '1000', step: '1', defaultValue: '14' });
  });

  it("renders a Source descriptor as a combobox whose options are every PriceSource value and whose initial selection matches the descriptor's default", async () => {
    render(
      <Theme>
        <IndicatorInputsForm
          inputs={[
            { type: FieldType.Source, key: 'source', label: 'Source', default: PriceSource.Close },
          ]}
          state={STATE_EMPTY}
          initialValues={{}}
          onSubmit={() => {}}
        />
      </Theme>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Source' });
    const user = userEvent.setup();
    await user.click(trigger);

    const optionLabels = (await screen.findAllByRole('option')).map((opt) => opt.textContent);
    expect({ initialLabel: trigger.textContent, optionLabels: optionLabels.sort() }).toEqual({
      initialLabel: PriceSource.Close,
      optionLabels: Object.values(PriceSource).sort(),
    });
  });

  it("renders an Enum descriptor as a combobox whose options match the descriptor's options[] and whose initial selection matches the descriptor's default", async () => {
    render(
      <Theme>
        <IndicatorInputsForm
          inputs={[
            {
              type: FieldType.Enum,
              key: 'mode',
              label: 'Mode',
              options: [
                { value: 'fast', label: 'Fast' },
                { value: 'slow', label: 'Slow' },
              ] as const,
              default: 'fast',
            },
          ]}
          state={STATE_EMPTY}
          initialValues={{}}
          onSubmit={() => {}}
        />
      </Theme>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Mode' });
    const user = userEvent.setup();
    await user.click(trigger);

    const optionLabels = (await screen.findAllByRole('option')).map((opt) => opt.textContent);
    expect({ initialLabel: trigger.textContent, optionLabels: optionLabels.sort() }).toEqual({
      initialLabel: 'Fast',
      optionLabels: ['Fast', 'Slow'],
    });
  });

  it('renders an info popover next to a labeled field when the descriptor has a description', async () => {
    render(
      <Theme>
        <IndicatorInputsForm
          inputs={[
            {
              type: FieldType.Number,
              key: 'length',
              label: 'Length',
              description: 'Number of candles in the window.',
              integer: true,
              default: 14,
            },
          ]}
          state={STATE_EMPTY}
          initialValues={{}}
          onSubmit={() => {}}
        />
      </Theme>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /about length/i }));

    expect(await screen.findByText('Number of candles in the window.')).not.toBeNull();
  });

  it('renders an inline required error and skips onSubmit when a Number field is empty on submit', async () => {
    const onSubmit = vi.fn();
    render(
      <Theme>
        <IndicatorInputsForm
          inputs={[
            {
              type: FieldType.Number,
              key: 'length',
              label: 'Length',
              integer: true,
              min: 1,
              max: 1_000,
            },
          ]}
          state={STATE_EMPTY}
          initialValues={{}}
          onSubmit={onSubmit}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /save|create|submit|attach/i }));

    expect({
      message: (await screen.findByRole('alert')).textContent,
      submitCalls: onSubmit.mock.calls,
    }).toEqual({ message: 'Length is required.', submitCalls: [] });
  });

  it("renders an inline min error and skips onSubmit when a Number value is below the descriptor's min", async () => {
    const onSubmit = vi.fn();
    render(
      <Theme>
        <IndicatorInputsForm
          inputs={[
            {
              type: FieldType.Number,
              key: 'length',
              label: 'Length',
              integer: true,
              min: 2,
              max: 1_000,
              default: 14,
            },
          ]}
          state={STATE_EMPTY}
          initialValues={{}}
          onSubmit={onSubmit}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    const input = screen.getByRole('spinbutton', { name: 'Length' });
    await user.clear(input);
    await user.type(input, '1');
    await user.click(screen.getByRole('button', { name: /save|create|submit|attach/i }));

    expect({
      message: (await screen.findByRole('alert')).textContent,
      submitCalls: onSubmit.mock.calls,
    }).toEqual({ message: 'Length must be ≥ 2.', submitCalls: [] });
  });

  it("renders an inline max error and skips onSubmit when a Number value is above the descriptor's max", async () => {
    const onSubmit = vi.fn();
    render(
      <Theme>
        <IndicatorInputsForm
          inputs={[
            {
              type: FieldType.Number,
              key: 'length',
              label: 'Length',
              integer: true,
              min: 1,
              max: 10,
              default: 5,
            },
          ]}
          state={STATE_EMPTY}
          initialValues={{}}
          onSubmit={onSubmit}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    const input = screen.getByRole('spinbutton', { name: 'Length' });
    await user.clear(input);
    await user.type(input, '11');
    await user.click(screen.getByRole('button', { name: /save|create|submit|attach/i }));

    expect({
      message: (await screen.findByRole('alert')).textContent,
      submitCalls: onSubmit.mock.calls,
    }).toEqual({ message: 'Length must be ≤ 10.', submitCalls: [] });
  });

  it('renders an inline integer error and skips onSubmit when a fractional value is given to an integer Number', async () => {
    const onSubmit = vi.fn();
    render(
      <Theme>
        <IndicatorInputsForm
          inputs={[
            {
              type: FieldType.Number,
              key: 'length',
              label: 'Length',
              integer: true,
              min: 1,
              max: 100,
              step: 0.1,
              default: 14,
            },
          ]}
          state={STATE_EMPTY}
          initialValues={{}}
          onSubmit={onSubmit}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    const input = screen.getByRole('spinbutton', { name: 'Length' });
    await user.clear(input);
    await user.type(input, '2.5');
    await user.click(screen.getByRole('button', { name: /save|create|submit|attach/i }));

    expect({
      message: (await screen.findByRole('alert')).textContent,
      submitCalls: onSubmit.mock.calls,
    }).toEqual({ message: 'Length must be an integer.', submitCalls: [] });
  });

  it('calls onSubmit with the current field values (defaults included) when the form is submitted', async () => {
    const onSubmit = vi.fn();
    render(
      <Theme>
        <IndicatorInputsForm
          inputs={[
            {
              type: FieldType.Number,
              key: 'length',
              label: 'Length',
              integer: true,
              min: 1,
              max: 1_000,
              default: 14,
            },
            { type: FieldType.Source, key: 'source', label: 'Source', default: PriceSource.Close },
          ]}
          state={STATE_EMPTY}
          initialValues={{}}
          onSubmit={onSubmit}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /save|create|submit|attach/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      inputs: { length: 14, source: PriceSource.Close },
    });
  });
});
