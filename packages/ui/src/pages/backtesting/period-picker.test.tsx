// @vitest-environment jsdom
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RANGE_OPTIONS } from '../../lib/backtest-range.js';
import { PeriodPicker } from './period-picker.js';

/** Milliseconds in one day. */
const MS_PER_DAY = 86_400_000;

/** A committed window: a fixed 30-day span in the past. */
const VALUE = { from: Date.UTC(2024, 0, 1), to: Date.UTC(2024, 0, 31) };

function renderPicker(): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  render(
    <Theme>
      <PeriodPicker value={VALUE} onChange={onChange} />
    </Theme>,
  );
  return { onChange };
}

describe('PeriodPicker', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a Period trigger for the committed range', () => {
    renderPicker();

    expect(screen.getByRole('button', { name: 'Period' })).toBeInTheDocument();
  });

  it('lists all ten presets in the sidebar when opened', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: 'Period' }));

    expect(
      RANGE_OPTIONS.map((option) => screen.getByRole('button', { name: option.label }) !== null),
    ).toEqual(RANGE_OPTIONS.map(() => true));
  });

  it('renders a freely-pickable dual-month calendar when opened', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: 'Period' }));

    // react-date-range day cells are bare <button.rdrDay> with only their day
    // number as an accessible name, so there is no better semantic anchor.
    const enabledDays = document.querySelectorAll('button.rdrDay:not([disabled])');
    expect(enabledDays.length > 0).toEqual(true);
  });

  it('applies the chosen preset as a concrete window on Apply', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.click(screen.getByRole('button', { name: 'Period' }));
    await user.click(screen.getByRole('button', { name: '90 Days' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const bounds = onChange.mock.calls.at(0)?.[0] as { from: number; to: number } | undefined;
    const span = (bounds?.to ?? Number.NaN) - (bounds?.from ?? Number.NaN);
    expect(span).toEqual(90 * MS_PER_DAY);
  });

  it('does not commit the draft when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.click(screen.getByRole('button', { name: 'Period' }));
    await user.click(screen.getByRole('button', { name: '1 Week' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
