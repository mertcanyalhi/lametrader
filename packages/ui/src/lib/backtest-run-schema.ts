import type { BacktestCommission, Period } from '@lametrader/core';
import * as yup from 'yup';
import type { BacktestRunInput } from './backtest.types.js';

/**
 * The values the `/backtesting` run form binds to.
 *
 * `from` / `to` are the replay window's concrete epoch-ms bounds — the Period
 * picker resolves whichever preset or freely-picked range the user chose to
 * these two numbers before they reach the form. The commission `*Enabled`
 * booleans mirror the Rate / Fixed checkboxes and gate their amount fields.
 * {@link toBacktestRunInput} folds these into the {@link BacktestRunInput} the
 * API takes (commissions dropped when unchecked).
 */
export interface BacktestRunFormValues {
  /** Starting equity; must be positive. */
  initialCapital: number;
  /** Replay window start, epoch ms. */
  from: number;
  /** Replay window end, epoch ms. */
  to: number;
  /** Whether a percentage commission rate applies. */
  commissionRateEnabled: boolean;
  /** Percent of each fill's notional (`0.1` = 0.1 %); applied when enabled. */
  commissionRate: number;
  /** Whether a flat per-fill commission applies. */
  commissionFixedEnabled: boolean;
  /** Flat amount charged per fill; applied when enabled. */
  commissionFixed: number;
}

/**
 * The **user-facing** validation layer for the run form — the client half of the
 * client/server split (per ADR 0011): it mirrors the API's numeric / range rules
 * (`initialCapital > 0`, `from < to`, `to ≤ now`, non-negative commissions) for
 * immediate feedback, while the server re-validates every start (including the
 * profile-scope and stored-candle rules the client can't check) and stays the
 * authority.
 *
 * A commission amount is only checked when its checkbox is enabled, so an
 * unchecked field never blocks a submit.
 */
export const backtestRunFormSchema: yup.ObjectSchema<BacktestRunFormValues> = yup.object({
  initialCapital: yup
    .number()
    .typeError('Initial capital must be a number.')
    .positive('Initial capital must be greater than 0.')
    .required('Initial capital must be greater than 0.'),
  from: yup.number().typeError('A start date is required.').required('A start date is required.'),
  to: yup
    .number()
    .typeError('An end date is required.')
    .required('An end date is required.')
    .test('after-from', 'Start must be before end.', (value, ctx) => {
      const { from } = ctx.parent as BacktestRunFormValues;
      return !Number.isFinite(from) || !Number.isFinite(value) || from < (value as number);
    })
    .test('not-future', 'End must not be in the future.', (value) => {
      return !Number.isFinite(value) || (value as number) <= Date.now();
    }),
  commissionRateEnabled: yup.boolean().required(),
  commissionRate: yup
    .number()
    .typeError('Commission rate must be a number.')
    .when('commissionRateEnabled', ([enabled]: boolean[], schema: yup.NumberSchema) =>
      enabled ? schema.min(0, 'Commission rate must be 0 or more.') : schema,
    )
    .required(),
  commissionFixedEnabled: yup.boolean().required(),
  commissionFixed: yup
    .number()
    .typeError('Fixed commission must be a number.')
    .when('commissionFixedEnabled', ([enabled]: boolean[], schema: yup.NumberSchema) =>
      enabled ? schema.min(0, 'Fixed commission must be 0 or more.') : schema,
    )
    .required(),
});

/** The run context the form can't set itself — the pickers' current selection. */
export interface BacktestRunContext {
  /** The selected strategy id. */
  strategyId: string;
  /** The selected symbol id. */
  symbolId: string;
  /** The selected profile id. */
  profileId: string;
  /** The selected chart period. */
  period: Period;
}

/**
 * Fold validated form values plus the picker context into the
 * {@link BacktestRunInput} the API takes: the window's `from` / `to` become the
 * run's `start` / `end`, and each commission field is included only when its
 * checkbox is enabled.
 *
 * @param values - the validated form values.
 * @param context - the strategy / symbol / profile / period selection.
 */
export function toBacktestRunInput(
  values: BacktestRunFormValues,
  context: BacktestRunContext,
): BacktestRunInput {
  const commission: BacktestCommission = {};
  if (values.commissionRateEnabled) commission.rate = values.commissionRate;
  if (values.commissionFixedEnabled) commission.fixed = values.commissionFixed;
  return {
    strategyId: context.strategyId,
    symbolId: context.symbolId,
    profileId: context.profileId,
    period: context.period,
    start: values.from,
    end: values.to,
    initialCapital: values.initialCapital,
    commission,
  };
}
