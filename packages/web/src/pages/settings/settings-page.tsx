import { type Config, Period } from '@lametrader/core';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { Button, Callout, Card, Heading, Select, Skeleton, Text } from '@radix-ui/themes';
import { type ReactNode, useEffect } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { cn } from '../../lib/cn.js';
import { useConfig, useUpdateConfig } from '../../lib/hooks/use-config.js';
import { getLogger } from '../../lib/log.js';
import { parseConfigResolver } from '../../lib/parse-config-resolver.js';

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
 * The form bound to the loaded config. Owns the local RHF state and the
 * mutation; the parent decides when to mount it (after the GET succeeds).
 */
function SettingsForm({ initial }: { initial: Config }): ReactNode {
  const update = useUpdateConfig();
  const { handleSubmit, watch, setValue, setError, formState } = useForm<Config>({
    resolver: parseConfigResolver,
    defaultValues: initial,
  });

  const periods = watch('periods');
  const defaultPeriod = watch('defaultPeriod');
  // The resolver attaches `parseConfig` failures to `errors.periods`; the
  // submit handler attaches server / network failures to `errors.root`. Both
  // surface in the same form-level Callout.
  const formError = formState.errors.periods?.message ?? formState.errors.root?.message;

  // When a period is toggled off in the bar that was the current default,
  // clear `defaultPeriod` so the dropdown reflects the new constraint
  // (`defaultPeriod ∈ periods`).
  useEffect(() => {
    if (defaultPeriod && !periods.includes(defaultPeriod)) {
      setValue('defaultPeriod', '' as Period, { shouldDirty: true, shouldValidate: false });
    }
  }, [defaultPeriod, periods, setValue]);

  const onSubmit: SubmitHandler<Config> = async (values) => {
    log.info({ periods: values.periods, defaultPeriod: values.defaultPeriod }, 'saving config');
    try {
      await update.mutateAsync(values);
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
          <header className="flex flex-col gap-1">
            <Heading as="h1" size="4">
              Settings
            </Heading>
            <Text as="p" color="gray" size="2">
              Pick which periods the platform tracks and which one is shown by default.
            </Text>
          </header>

          <section className="flex flex-col gap-2">
            <Text as="label" htmlFor="periods-bar" size="2" weight="medium">
              Periods
            </Text>
            <ToggleGroup.Root
              id="periods-bar"
              type="multiple"
              value={periods}
              onValueChange={(next) =>
                setValue('periods', next as Period[], { shouldDirty: true, shouldValidate: false })
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
          </section>

          <section className="flex flex-col gap-2">
            <Text as="label" htmlFor="default-period-trigger" size="2" weight="medium">
              Default period
            </Text>
            <Select.Root
              value={defaultPeriod || undefined}
              onValueChange={(next) =>
                setValue('defaultPeriod', next as Period, {
                  shouldDirty: true,
                  shouldValidate: false,
                })
              }
            >
              <Select.Trigger
                id="default-period-trigger"
                placeholder="Select default period"
                aria-label="Default period"
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
          </section>

          {formError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{formError}</Callout.Text>
            </Callout.Root>
          ) : null}

          <footer className="flex justify-end">
            <Button type="submit" disabled={!formState.isDirty || update.isPending}>
              Save
            </Button>
          </footer>
        </div>
      </Card>
    </form>
  );
}
