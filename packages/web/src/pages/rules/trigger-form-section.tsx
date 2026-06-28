import { Period, type Trigger, TriggerKind } from '@lametrader/core';
import { Box, Flex, Select, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { type Control, Controller } from 'react-hook-form';
import * as yup from 'yup';

import type { RuleFormValues } from '../../lib/rule-form-schema.js';

/** Human label for the `Trigger` field row + the schema's `${label}` interpolation. */
export const TRIGGER_LABEL = 'Trigger';
/** Human label for the `Trigger period` sub-field — used by the schema's error messages. */
const TRIGGER_PERIOD_LABEL = 'Trigger period';
/** Human label for the `Trigger interval (ms)` sub-field — used by the schema's error messages. */
const TRIGGER_INTERVAL_MS_LABEL = 'Trigger interval (ms)';

/** Default re-fire interval for `OncePerMinute` — matches the engine default. */
export const DEFAULT_TRIGGER_INTERVAL_MS = 60_000;

/** The trigger kinds whose schema requires a `period`. Single source of truth. */
const BAR_BASED_TRIGGER_KINDS = new Set<TriggerKind>([
  TriggerKind.OncePerBar,
  TriggerKind.OncePerBarClose,
]);

/** Whether the given trigger kind requires a `period`. */
export function isBarBasedTrigger(kind: TriggerKind): boolean {
  return BAR_BASED_TRIGGER_KINDS.has(kind);
}

/** Human label for every trigger kind — used as the dropdown option text. */
const TRIGGER_LABELS: Record<TriggerKind, string> = {
  [TriggerKind.Once]: 'Once',
  [TriggerKind.OncePerBar]: 'Once per bar',
  [TriggerKind.OncePerBarClose]: 'Once per bar close',
  [TriggerKind.OncePerMinute]: 'Once per interval',
};

/**
 * Schema slice for the trigger sub-form. Parent composes via object spread:
 *
 *   yup.object({ name: ..., ...triggerFormFields, expiration: ... })
 *
 * Owns the cross-field "period required for bar-based triggers" rule — the
 * single source of truth for what counts as bar-based lives in
 * {@link isBarBasedTrigger}, used both here and in the JSX below.
 */
export const triggerFormFields = {
  triggerKind: yup
    .mixed<TriggerKind>()
    .oneOf(Object.values(TriggerKind))
    .required()
    .label(TRIGGER_LABEL),
  triggerPeriod: yup
    .mixed<Period | ''>()
    .oneOf(['' as const, ...Object.values(Period)])
    .defined()
    .test(
      'period-required-for-bar-triggers',
      ({ label }) => `${label} is required.`,
      function check(value) {
        const kind = this.parent.triggerKind as TriggerKind;
        if (!isBarBasedTrigger(kind)) return true;
        return Object.values(Period).includes(value as Period);
      },
    )
    .label(TRIGGER_PERIOD_LABEL),
  triggerIntervalMs: yup
    .number()
    .typeError(({ label }) => `${label} must be a number.`)
    .integer()
    .min(1, ({ label }) => `${label} must be at least 1 ms.`)
    .required()
    .label(TRIGGER_INTERVAL_MS_LABEL),
};

/** Default trigger-related form values for a new rule. */
export const triggerFormDefaults = {
  triggerKind: TriggerKind.Once,
  triggerPeriod: '' as Period | '',
  triggerIntervalMs: DEFAULT_TRIGGER_INTERVAL_MS,
};

/**
 * Build a domain {@link Trigger} from the flat trigger form values.
 *
 * Validation has already rejected `triggerPeriod === ''` for bar-based kinds
 * by the time this runs.
 */
export function triggerFromForm(values: {
  triggerKind: TriggerKind;
  triggerPeriod: Period | '';
  triggerIntervalMs: number;
}): Trigger {
  switch (values.triggerKind) {
    case TriggerKind.Once:
      return { kind: TriggerKind.Once };
    case TriggerKind.OncePerBar:
      return { kind: TriggerKind.OncePerBar, period: values.triggerPeriod as Period };
    case TriggerKind.OncePerBarClose:
      return { kind: TriggerKind.OncePerBarClose, period: values.triggerPeriod as Period };
    case TriggerKind.OncePerMinute:
      return { kind: TriggerKind.OncePerMinute, intervalMs: values.triggerIntervalMs };
  }
}

/** Project a domain {@link Trigger} onto the form-value shape (for edit mode). */
export function triggerToForm(trigger: Trigger): typeof triggerFormDefaults {
  const triggerPeriod: Period | '' =
    trigger.kind === TriggerKind.OncePerBar || trigger.kind === TriggerKind.OncePerBarClose
      ? trigger.period
      : '';
  const triggerIntervalMs =
    trigger.kind === TriggerKind.OncePerMinute ? trigger.intervalMs : DEFAULT_TRIGGER_INTERVAL_MS;
  return { triggerKind: trigger.kind, triggerPeriod, triggerIntervalMs };
}

/**
 * The trigger-gate picker for the rule editor — owns both the inputs AND its
 * slice of the form schema. Receives the form's `control` and wires sub-fields
 * via {@link Controller}, reading per-field errors from each `fieldState`.
 *
 * Add a new trigger kind = edit this file only (enum, label, JSX branch,
 * schema, defaults, mapping — all here).
 */
export function TriggerFormSection({ control }: { control: Control<RuleFormValues> }): ReactNode {
  return (
    <Controller
      name="triggerKind"
      control={control}
      render={({ field: kindField }) => (
        <Flex direction="column" gap="2">
          <Select.Root
            value={kindField.value}
            onValueChange={(next) => kindField.onChange(next as TriggerKind)}
          >
            <Select.Trigger aria-label="Trigger" />
            <Select.Content>
              {Object.values(TriggerKind).map((value) => (
                <Select.Item key={value} value={value}>
                  {TRIGGER_LABELS[value]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>

          {isBarBasedTrigger(kindField.value) && (
            <Controller
              name="triggerPeriod"
              control={control}
              render={({ field, fieldState: { error } }) => {
                const periodErrorId = error?.message ? 'rule-trigger-period-error' : undefined;
                return (
                  <Box>
                    <Select.Root
                      value={field.value === '' ? undefined : field.value}
                      onValueChange={(next) => field.onChange(next as Period)}
                    >
                      <Select.Trigger
                        placeholder="Pick a period"
                        aria-label="Trigger period"
                        aria-invalid={error?.message ? true : undefined}
                        aria-describedby={periodErrorId}
                      />
                      <Select.Content>
                        {Object.values(Period).map((value) => (
                          <Select.Item key={value} value={value}>
                            {value}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                    {error?.message && (
                      <Text id={periodErrorId} role="alert" color="red" size="1">
                        {error.message}
                      </Text>
                    )}
                  </Box>
                );
              }}
            />
          )}

          {kindField.value === TriggerKind.OncePerMinute && (
            <Controller
              name="triggerIntervalMs"
              control={control}
              render={({ field }) => (
                <Box>
                  <TextField.Root
                    type="number"
                    aria-label="Trigger interval (ms)"
                    value={Number.isFinite(field.value) ? String(field.value) : ''}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      field.onChange(Number.isFinite(parsed) ? parsed : 0);
                    }}
                  />
                </Box>
              )}
            />
          )}
        </Flex>
      )}
    />
  );
}
