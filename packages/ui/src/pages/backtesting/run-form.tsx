import { yupResolver } from '@hookform/resolvers/yup';
import type { Period } from '@lametrader/core';
import { Button, Callout, Checkbox, Flex, Text, TextField } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import {
  type Control,
  Controller,
  type FieldError,
  type SubmitHandler,
  type UseFormRegister,
  useForm,
} from 'react-hook-form';
import { ApiError } from '../../lib/api-fetch.js';
import {
  type BacktestRunFormValues,
  backtestRunFormSchema,
  toBacktestRunInput,
} from '../../lib/backtest-run-schema.js';
import { useStartBacktest } from '../../lib/hooks/backtests.js';
import { getLogger } from '../../lib/log.js';
import { PeriodPicker } from './period-picker.js';

/** Scoped logger for run-form submission failures. */
const log = getLogger('backtest-run-form');

/** Milliseconds in one day. */
const MS_PER_DAY = 86_400_000;

/**
 * The run form's initial values: a positive starting capital, a trailing
 * 90-day window ending now, and both commissions off.
 */
function defaultValues(): BacktestRunFormValues {
  const now = Date.now();
  return {
    initialCapital: 10_000,
    from: now - 90 * MS_PER_DAY,
    to: now,
    commissionRateEnabled: false,
    commissionRate: 0,
    commissionFixedEnabled: false,
    commissionFixed: 0,
  };
}

/**
 * The `/backtesting` run form: initial capital, the Period range picker, and
 * Rate / Fixed commission checkboxes with amount fields, plus the Run action
 * (spec: *UI — run flow*).
 *
 * Validation is the client mirror of the API's numeric / date rules
 * ({@link backtestRunFormSchema}) for immediate feedback; the server re-validates
 * on start and its `400` / `409` errors (an incomplete strategy, an out-of-scope
 * or disabled profile, no stored candles, or another run already active) surface
 * through the standard {@link ApiError} envelope as a form-level callout.
 *
 * The Run button is disabled until a strategy and a profile are selected — the
 * run needs both, and neither is a form field.
 *
 * @param strategyId - the selected strategy id, or `null` when none is selected.
 * @param symbolId - the selected symbol id.
 * @param profileId - the selected profile id, or `null` when none is selected.
 * @param period - the selected chart period.
 * @param onStarted - called with the new run's id once the server accepts it.
 */
export function RunForm({
  strategyId,
  symbolId,
  profileId,
  period,
  onStarted,
}: {
  strategyId: string | null;
  symbolId: string;
  profileId: string | null;
  period: Period;
  onStarted: (backtestId: string) => void;
}): ReactNode {
  const start = useStartBacktest();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BacktestRunFormValues>({
    resolver: yupResolver(backtestRunFormSchema),
    defaultValues: defaultValues(),
  });

  const rateEnabled = watch('commissionRateEnabled');
  const fixedEnabled = watch('commissionFixedEnabled');
  const from = watch('from');
  const to = watch('to');
  const periodError = errors.from?.message ?? errors.to?.message;
  const canRun = strategyId !== null && profileId !== null;

  const onSubmit: SubmitHandler<BacktestRunFormValues> = async (values) => {
    if (strategyId === null || profileId === null) return;
    setServerError(null);
    try {
      const backtest = await start.mutateAsync(
        toBacktestRunInput(values, { strategyId, symbolId, profileId, period }),
      );
      onStarted(backtest.id);
    } catch (error) {
      if (error instanceof ApiError) {
        setServerError(error.message);
        return;
      }
      log.warn({ err: error }, 'failed to start backtest');
      setServerError('Could not start the backtest.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} aria-label="Run backtest" noValidate>
      <Flex direction="column" gap="3">
        {serverError !== null ? (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{serverError}</Callout.Text>
          </Callout.Root>
        ) : null}

        <Field label="Initial capital" htmlFor="bt-initial-capital" error={errors.initialCapital}>
          <TextField.Root
            id="bt-initial-capital"
            type="number"
            inputMode="decimal"
            step="any"
            {...register('initialCapital', { valueAsNumber: true })}
          />
        </Field>

        <div>
          <Text as="div" size="2" weight="medium" mb="1">
            Period
          </Text>
          <PeriodPicker
            value={{ from, to }}
            onChange={(bounds) => {
              setValue('from', bounds.from, { shouldValidate: true });
              setValue('to', bounds.to, { shouldValidate: true });
            }}
          />
          {periodError ? (
            <Text size="1" color="red" mt="1" className="block" role="alert">
              {periodError}
            </Text>
          ) : null}
        </div>

        <CommissionRow
          control={control}
          enabledName="commissionRateEnabled"
          amountName="commissionRate"
          label="Rate"
          amountLabel="Commission rate"
          suffix="%"
          enabled={rateEnabled}
          register={register}
          error={errors.commissionRate}
        />
        <CommissionRow
          control={control}
          enabledName="commissionFixedEnabled"
          amountName="commissionFixed"
          label="Fixed"
          amountLabel="Fixed commission"
          suffix=""
          enabled={fixedEnabled}
          register={register}
          error={errors.commissionFixed}
        />

        {!canRun ? (
          <Text size="1" color="gray">
            Select a strategy and a profile to run.
          </Text>
        ) : null}

        <Button type="submit" disabled={!canRun} loading={start.isPending}>
          Run backtest
        </Button>
      </Flex>
    </form>
  );
}

/** A labelled form field with its inline validation message. */
function Field({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: FieldError;
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={className}>
      <Text as="label" htmlFor={htmlFor} size="2" weight="medium" mb="1" className="block">
        {label}
      </Text>
      {children}
      {error?.message ? (
        <Text size="1" color="red" mt="1" className="block" role="alert">
          {error.message}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * One commission row: a checkbox that toggles a percentage-or-flat amount field,
 * disabled and dimmed while the checkbox is off.
 */
function CommissionRow({
  control,
  enabledName,
  amountName,
  label,
  amountLabel,
  suffix,
  enabled,
  register,
  error,
}: {
  control: Control<BacktestRunFormValues>;
  enabledName: 'commissionRateEnabled' | 'commissionFixedEnabled';
  amountName: 'commissionRate' | 'commissionFixed';
  label: string;
  amountLabel: string;
  suffix: string;
  enabled: boolean;
  register: UseFormRegister<BacktestRunFormValues>;
  error?: FieldError;
}): ReactNode {
  return (
    <Flex direction="column" gap="1">
      <Flex gap="3" align="center">
        <Text as="label" size="2" className="w-24">
          <Flex gap="2" align="center">
            <Controller
              control={control}
              name={enabledName}
              render={({ field }) => (
                <Checkbox
                  aria-label={`${label} commission enabled`}
                  checked={field.value}
                  onCheckedChange={(next) => field.onChange(next === true)}
                />
              )}
            />
            {label}
          </Flex>
        </Text>
        <TextField.Root
          aria-label={amountLabel}
          type="number"
          inputMode="decimal"
          step="any"
          disabled={!enabled}
          className="grow"
          {...register(amountName, { valueAsNumber: true })}
        >
          {suffix ? <TextField.Slot side="right">{suffix}</TextField.Slot> : null}
        </TextField.Root>
      </Flex>
      {error?.message ? (
        <Text size="1" color="red" role="alert" className="block">
          {error.message}
        </Text>
      ) : null}
    </Flex>
  );
}
