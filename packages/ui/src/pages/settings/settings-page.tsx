import { yupResolver } from '@hookform/resolvers/yup';
import type { Config, Period } from '@lametrader/core';
import {
  Box,
  Button,
  Callout,
  Card,
  Heading,
  Select,
  Skeleton,
  Tabs,
  Text,
} from '@radix-ui/themes';
import { type ReactNode, useEffect } from 'react';
import { type Resolver, type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FieldLabel } from '../../components/field-label.js';
import { PeriodToggleGroup } from '../../components/period-toggle-group.js';
import { ApiError } from '../../lib/api-fetch.js';
import { configSchema, FIELD_LABELS } from '../../lib/config-schema.js';
import { useConfig, useUpdateConfig } from '../../lib/hooks/use-config.js';
import { getLogger } from '../../lib/log.js';
import { PERIOD_ORDER } from '../../lib/periods.js';
import { NotificationsSection } from './notifications-section.js';

/**
 * Scoped logger for the settings page — form/save lifecycle events.
 * The lower `api-fetch` / `query-client` scopes still log their layer.
 */
const log = getLogger('settings-page');

/**
 * The `/settings` route component.
 *
 * Splits settings into **General** (the platform config form) and
 * **Notifications** (the generic notification-config table) tabs. Each tab owns
 * its own data-loading (the config query for General, the notifications query
 * for Notifications), so the inactive tab's request doesn't fire until it is
 * activated.
 */
export function SettingsPage(): ReactNode {
  return (
    <Tabs.Root defaultValue="general">
      <Tabs.List>
        <Tabs.Trigger value="general">General</Tabs.Trigger>
        <Tabs.Trigger value="notifications">Notifications</Tabs.Trigger>
      </Tabs.List>
      <Box pt="4">
        <Tabs.Content value="general">
          <GeneralTab />
        </Tabs.Content>
        <Tabs.Content value="notifications">
          <NotificationsSection />
        </Tabs.Content>
      </Box>
    </Tabs.Root>
  );
}

/**
 * The General tab — loads the platform config via `useConfig` and renders the
 * appropriate state (skeleton, error callout, or the bound form). The form
 * lives in `SettingsForm` so it can mount fresh once the initial GET resolves —
 * react-hook-form's `defaultValues` are captured on mount, so a fresh mount
 * after load is the cleanest way to hydrate them.
 */
function GeneralTab(): ReactNode {
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
 * Form shape: `defaultPeriod` may be transiently empty (cleared) before the user
 * re-picks, which `Config` (where it is a required `Period`) can't represent.
 * The Yup resolver still requires a real `Period`, so a submitted value is a
 * full `Config`.
 */
type ConfigForm = Omit<Config, 'defaultPeriod'> & { defaultPeriod: Period | '' };

/**
 * The form bound to the loaded config. Owns the local RHF state and the
 * mutation; the parent decides when to mount it (after the GET succeeds).
 */
function SettingsForm({ initial }: { initial: Config }): ReactNode {
  const update = useUpdateConfig();
  const { handleSubmit, watch, setValue, setError, reset, formState } = useForm<
    ConfigForm,
    unknown,
    Config
  >({
    // The form input is `ConfigForm` (its `defaultPeriod` may be transiently
    // `''`); the schema rejects `''` via `.required()` and validates to a full
    // `Config`. yupResolver can't infer that input≠output split from an
    // `ObjectSchema<Config>`, so bridge the resolver shape here once — the only
    // place the two shapes meet — rather than casting the empty value at each
    // call site.
    resolver: yupResolver(configSchema) as unknown as Resolver<ConfigForm, unknown, Config>,
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
      setValue('defaultPeriod', '', { shouldDirty: true, shouldValidate: true });
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
            <PeriodToggleGroup
              id="periods-bar"
              options={PERIOD_ORDER}
              value={periods}
              disabled={update.isPending}
              ariaInvalid={periodsError ? true : undefined}
              ariaDescribedBy={periodsError ? 'periods-error' : undefined}
              onValueChange={(next) =>
                setValue('periods', next, { shouldDirty: true, shouldValidate: true })
              }
            />
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
              /* `next` is a Select.Item value, always one of the rendered Period members. */
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
