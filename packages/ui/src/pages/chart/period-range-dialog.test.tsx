// @vitest-environment jsdom
import { Period } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartRange } from './chart-range.js';
import { PeriodRangeDialog } from './period-range-dialog.js';

describe('PeriodRangeDialog', () => {
  afterEach(() => cleanup());

  it('labels the trigger with the current period, suffixed by the range when one is set', () => {
    render(
      <Theme>
        <PeriodRangeDialog
          period={Period.OneHour}
          range={ChartRange.OneYear}
          watchedPeriods={[Period.OneHour]}
          onApply={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole('button', { name: '1h · 1Y' })).toBeInTheDocument();
  });

  it('applies the chosen range and period as a single URL update', async () => {
    const applied = vi.fn();
    render(
      <Theme>
        <PeriodRangeDialog
          period={Period.OneHour}
          range={null}
          watchedPeriods={[Period.OneHour, Period.OneDay]}
          onApply={applied}
        />
      </Theme>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '1h' }));
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: '1Y' }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '1d', pressed: false }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Apply' }));
    });

    await waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
    expect(applied.mock.calls[0]?.[0]).toEqual({
      period: Period.OneDay,
      range: ChartRange.OneYear,
    });
  });

  it('disables a period the symbol is not watched on', async () => {
    render(
      <Theme>
        <PeriodRangeDialog
          period={Period.OneHour}
          range={null}
          watchedPeriods={[Period.OneHour]}
          onApply={() => undefined}
        />
      </Theme>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '1h' }));

    expect({
      oneDayDisabled: screen.getByRole('button', { name: '1d' }).hasAttribute('disabled'),
      oneHourEnabled: !screen
        .getByRole('button', { name: '1h', pressed: true })
        .hasAttribute('disabled'),
    }).toEqual({ oneDayDisabled: true, oneHourEnabled: true });
  });
});
