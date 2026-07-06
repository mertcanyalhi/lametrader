import { Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import {
  type BacktestRunFormValues,
  backtestRunFormSchema,
  toBacktestRunInput,
} from './backtest-run-schema.js';

/** A far-future date so `end ≤ now` fails deterministically regardless of clock. */
const FUTURE_DATE = '2999-01-01';

function values(overrides: Partial<BacktestRunFormValues> = {}): BacktestRunFormValues {
  return {
    initialCapital: 1_000,
    start: '2024-01-01',
    end: '2024-02-01',
    commissionRateEnabled: false,
    commissionRate: 0,
    commissionFixedEnabled: false,
    commissionFixed: 0,
    ...overrides,
  };
}

async function validate(input: BacktestRunFormValues): Promise<string[]> {
  try {
    await backtestRunFormSchema.validate(input, { abortEarly: false });
    return [];
  } catch (error) {
    return (error as { errors: string[] }).errors;
  }
}

describe('backtestRunFormSchema', () => {
  it('accepts a well-formed form with no commissions', async () => {
    expect(await validate(values())).toEqual([]);
  });

  it('rejects a non-positive initial capital', async () => {
    expect(await validate(values({ initialCapital: 0 }))).toEqual([
      'Initial capital must be greater than 0.',
    ]);
  });

  it('rejects a start on or after the end', async () => {
    expect(await validate(values({ start: '2024-02-01', end: '2024-02-01' }))).toEqual([
      'Start must be before end.',
    ]);
  });

  it('rejects an end date in the future', async () => {
    expect(await validate(values({ start: '2024-01-01', end: FUTURE_DATE }))).toEqual([
      'End must not be in the future.',
    ]);
  });

  it('rejects a negative commission rate when the rate is enabled', async () => {
    expect(await validate(values({ commissionRateEnabled: true, commissionRate: -1 }))).toEqual([
      'Commission rate must be 0 or more.',
    ]);
  });

  it('rejects a negative fixed commission when the fixed fee is enabled', async () => {
    expect(await validate(values({ commissionFixedEnabled: true, commissionFixed: -2 }))).toEqual([
      'Fixed commission must be 0 or more.',
    ]);
  });

  it('ignores a negative commission amount while its checkbox is unchecked', async () => {
    expect(await validate(values({ commissionRateEnabled: false, commissionRate: -5 }))).toEqual(
      [],
    );
  });
});

describe('toBacktestRunInput', () => {
  it('maps enabled commissions and UTC-midnight dates into the run input', () => {
    expect(
      toBacktestRunInput(
        values({
          initialCapital: 2_500,
          start: '2024-01-01',
          end: '2024-03-01',
          commissionRateEnabled: true,
          commissionRate: 0.1,
          commissionFixedEnabled: true,
          commissionFixed: 1.5,
        }),
        {
          strategyId: 's-1',
          symbolId: 'crypto:BTCUSDT',
          profileId: 'p-1',
          period: Period.OneHour,
        },
      ),
    ).toEqual({
      strategyId: 's-1',
      symbolId: 'crypto:BTCUSDT',
      profileId: 'p-1',
      period: Period.OneHour,
      start: Date.UTC(2024, 0, 1),
      end: Date.UTC(2024, 2, 1),
      initialCapital: 2_500,
      commission: { rate: 0.1, fixed: 1.5 },
    });
  });

  it('omits commission fields whose checkboxes are unchecked', () => {
    expect(
      toBacktestRunInput(values({ commissionRateEnabled: false, commissionFixedEnabled: false }), {
        strategyId: 's-1',
        symbolId: 'crypto:BTCUSDT',
        profileId: 'p-1',
        period: Period.OneDay,
      }).commission,
    ).toEqual({});
  });
});
