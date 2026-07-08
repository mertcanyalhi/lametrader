import { yupResolver } from '@hookform/resolvers/yup';
import type { Backtest, Period } from '@lametrader/core';
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
import { CollapsibleGroup } from '../../components/collapsible-group.js';
import { ApiError } from '../../lib/api-fetch.js';
import type { RangeBounds } from '../../lib/backtest-range.js';
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

/**
 * The run form's initial values: a positive starting capital, the caller-owned
 * date window (lifted so it survives the form unmounting while a run streams),
 * and both commissions off.
 */
function defaultValues(runWindow: RangeBounds): BacktestRunFormValues {
  return {
    initialCapital: 10_000,
    from: runWindow.from,
    to: runWindow.to,
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
 * @param runWindow - the backtest date window, owned by the parent so it
 *   persists across the form unmounting mid-run.
 * @param onWindowChange - lifts a new date-window selection up to the parent.
 * @param onStarted - called with the created run once the server accepts it.
 */
export function RunForm({
  strategyId,
  symbolId,
  profileId,
  period,
  runWindow,
  onWindowChange,
  onStarted,
}: {
  strategyId: string | null;
  symbolId: string;
  profileId: string | null;
  period: Period;
  runWindow: RangeBounds;
  onWindowChange: (bounds: RangeBounds) => void;
  onStarted: (backtest: Backtest) => void;
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
    defaultValues: defaultValues(runWindow),
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
      onStarted(backtest);
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

        <div>
          <Text as="div" size="2" weight="medium" mb="1">
            Period
          </Text>
          <PeriodPicker
            value={{ from, to }}
            onChange={(bounds) => {
              setValue('from', bounds.from, { shouldValidate: true });
              setValue('to', bounds.to, { shouldValidate: true });
              onWindowChange(bounds);
            }}
          />
          {periodError ? (
            <Text size="1" color="red" mt="1" className="block" role="alert">
              {periodError}
            </Text>
          ) : null}
        </div>

        <Field label="Initial capital" htmlFor="bt-initial-capital" error={errors.initialCapital}>
          <TextField.Root
            id="bt-initial-capital"
            type="number"
            inputMode="decimal"
            step="any"
            {...register('initialCapital', { valueAsNumber: true })}
          />
        </Field>

        <CollapsibleGroup title="Commission">
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
        </CollapsibleGroup>

        <Button type="submit" disabled={!canRun} loading={start.isPending}>
          Run backtest
        </Button>

        {!canRun ? (
          <Text size="1" color="gray">
            Select a strategy and a profile to run.
          </Text>
        ) : null}
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
