import { type Config, Period } from '@lametrader/core';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  Button,
  Callout,
  Card,
  Heading,
  IconButton,
  Popover,
  Select,
  Skeleton,
  Text,
} from '@radix-ui/themes';
import { Info } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { cn } from '../../lib/cn.js';
import { useConfig, useUpdateConfig } from '../../lib/hooks/use-config.js';
import { getLogger } from '../../lib/log.js';
import { FIELD_LABELS, parseConfigResolver } from '../../lib/parse-config-resolver.js';

/**
 * Scoped logger for the settings page — form/save lifecycle events.
 * The lower `api-fetch` / `query-client` scopes still log their layer.
 */
const log = getLogger('settings-page');

/**
 * The order in which periods are rendered in the timeframe bar.
 * Mirrors `Period`'s declared order, smallest first.
 */
const PERIOD_ORDER: Period[] = [
  Period.OneMinute,
  Period.FiveMinutes,
  Period.FifteenMinutes,
  Period.ThirtyMinutes,
  Period.OneHour,
  Period.FourHours,
  Period.OneDay,
  Period.OneWeek,
];

/**
 * The `/settings` route component.
 *
 * Loads the platform config via `useConfig` and renders the appropriate state
 * (skeleton, error callout, or the bound form). The form itself lives in
 * `SettingsForm` so it can mount fresh once the initial GET resolves — react-
 * hook-form's `defaultValues` are captured on mount, so a fresh mount after
 * load is the cleanest way to hydrate them.
 */
export function SettingsPage(): ReactNode {
  const query = useConfig();

  if (query.isPending) {
    return <SettingsSkeleton />;
  }
  if (query.isError) {
    return (
      <Callout.Root color="red" role="alert">
        <Callout.Text>{query.error.message}</Callout.Text>
      </Callout.Root>
    );
  }
  return <SettingsForm initial={query.data} />;
}

/**
 * Loading placeholder rendered while the initial `GET /config` is pending.
 * A `data-testid` anchors the assertion in the smoke test.
 */
function SettingsSkeleton(): ReactNode {
  return (
    <Card data-testid="settings-skeleton">
      <div className="flex flex-col gap-4 p-2">
        <Skeleton height="1.25rem" width="6rem" />
        <Skeleton height="2rem" width="100%" />
        <Skeleton height="1.25rem" width="8rem" />
        <Skeleton height="2rem" width="12rem" />
      </div>
    </Card>
  );
}

/**
 * A field label paired with an info icon that opens a popover explaining what
 * the setting is for. A popover (click/tap) rather than a tooltip (hover) so
 * the explanation is reachable on touch devices, which have no hover. The icon
 * button carries an `aria-label` so it has an accessible name before opening.
 */
function FieldLabel({
  htmlFor,
  label,
  hint,
  hintLabel,
}: {
  /** Id of the control this labels. */
  htmlFor: string;
  /** Visible label text. */
  label: string;
  /** The explanation shown in the info popover. */
  hint: string;
  /** Accessible name for the info icon button. */
  hintLabel: string;
}): ReactNode {
  return (
    <div className="flex items-center gap-1.5">
      <Text as="label" htmlFor={htmlFor} size="2" weight="medium">
        {label}
      </Text>
      <Popover.Root>
        <Popover.Trigger>
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            size="1"
            radius="full"
            aria-label={hintLabel}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        </Popover.Trigger>
        <Popover.Content size="1" maxWidth="280px">
          <Text as="p" size="2">
            {hint}
          </Text>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}

/**
 * The form bound to the loaded config. Owns the local RHF state and the
 * mutation; the parent decides when to mount it (after the GET succeeds).
 */
function SettingsForm({ initial }: { initial: Config }): ReactNode {
  const update = useUpdateConfig();
  const { handleSubmit, watch, setValue, setError, reset, formState } = useForm<Config>({
    resolver: parseConfigResolver,
    defaultValues: initial,
    // Validate on every change so field errors appear live and `isValid` can
    // gate the Save button rather than waiting for a submit attempt.
    mode: 'onChange',
  });

  const periods = watch('periods');
  const defaultPeriod = watch('defaultPeriod');
  // Field-level validation errors (shown inline on each control).
  const periodsError = formState.errors.periods?.message;
  const defaultPeriodError = formState.errors.defaultPeriod?.message;
  // Server / network failures from the submit handler — shown form-level.
  const submitError = formState.errors.root?.message;

  // When a period is toggled off in the bar that was the current default,
  // clear `defaultPeriod` so the dropdown reflects the new constraint
  // (`defaultPeriod ∈ periods`). Revalidate so the "select a default" error
  // surfaces immediately.
  useEffect(() => {
    if (defaultPeriod && !periods.includes(defaultPeriod)) {
      setValue('defaultPeriod', '' as Period, { shouldDirty: true, shouldValidate: true });
    }
  }, [defaultPeriod, periods, setValue]);

  const onSubmit: SubmitHandler<Config> = async (values) => {
    log.info({ periods: values.periods, defaultPeriod: values.defaultPeriod }, 'saving config');
    try {
      const saved = await update.mutateAsync(values);
      // Re-baseline the form to the persisted config so `isDirty` clears and
      // Save disables until the next edit — otherwise the baseline stays the
      // originally-loaded config and Save stays enabled after a save.
      reset(saved);
      toast.success('Settings saved');
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to save settings';
      setError('root', { type: 'server', message });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Card>
        <div className="flex flex-col gap-6 p-2">
          <header>
            <Heading as="h1" size="4">
              Settings
            </Heading>
          </header>

          <section className="flex flex-col gap-2">
            <FieldLabel
              htmlFor="periods-bar"
              label={FIELD_LABELS.periods}
              hintLabel="About the periods setting"
              hint="The candle timeframes the platform tracks for each symbol (for example 1h, 1d). Toggle a timeframe on to start tracking it."
            />
            <ToggleGroup.Root
              id="periods-bar"
              type="multiple"
              value={periods}
              disabled={update.isPending}
              aria-invalid={periodsError ? true : undefined}
              aria-describedby={periodsError ? 'periods-error' : undefined}
              onValueChange={(next) =>
                setValue('periods', next as Period[], { shouldDirty: true, shouldValidate: true })
              }
              className="flex flex-wrap gap-1"
            >
              {PERIOD_ORDER.map((period) => (
                <ToggleGroup.Item
                  key={period}
                  value={period}
                  className={cn(
                    'inline-flex h-8 min-w-12 items-center justify-center rounded-md',
                    'border border-[var(--gray-a6)] bg-[var(--color-surface)] px-3 text-sm',
                    'text-[var(--gray-12)] transition-colors',
                    'hover:bg-[var(--gray-a3)]',
                    'data-[state=on]:border-[var(--accent-9)] data-[state=on]:bg-[var(--accent-9)] data-[state=on]:text-[var(--accent-contrast)]',
                  )}
                >
                  {period}
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
            {periodsError ? (
              <Text id="periods-error" role="alert" color="red" size="1">
                {periodsError}
              </Text>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <FieldLabel
              htmlFor="default-period-trigger"
              label={FIELD_LABELS.defaultPeriod}
              hintLabel="About the default period setting"
              hint="The timeframe shown by default when you open a symbol. It must be one of the tracked periods above."
            />
            <Select.Root
              value={defaultPeriod || undefined}
              disabled={update.isPending}
              onValueChange={(next) =>
                setValue('defaultPeriod', next as Period, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            >
              <Select.Trigger
                id="default-period-trigger"
                placeholder="Select default period"
                aria-label="Default period"
                aria-invalid={defaultPeriodError ? true : undefined}
                aria-describedby={defaultPeriodError ? 'default-period-error' : undefined}
                className="w-40"
              />
              <Select.Content>
                {PERIOD_ORDER.filter((period) => periods.includes(period)).map((period) => (
                  <Select.Item key={period} value={period}>
                    {period}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            {defaultPeriodError ? (
              <Text id="default-period-error" role="alert" color="red" size="1">
                {defaultPeriodError}
              </Text>
            ) : null}
          </section>

          {submitError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{submitError}</Callout.Text>
            </Callout.Root>
          ) : null}

          <footer className="flex justify-end">
            <Button
              type="submit"
              loading={update.isPending}
              aria-busy={update.isPending}
              disabled={!formState.isDirty || !formState.isValid || update.isPending}
            >
              Save
            </Button>
          </footer>
        </div>
      </Card>
    </form>
  );
}
