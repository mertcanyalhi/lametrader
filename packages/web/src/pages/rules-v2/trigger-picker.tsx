import { Period, RulesV2 } from '@lametrader/core';
import { Box, Flex, Select, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { type Control, Controller } from 'react-hook-form';
import { isBarBasedTriggerV2, type RuleV2FormValues } from '../../lib/rule-v2-form-schema.js';

/** Human label for every v2 trigger kind — used as the dropdown option text. */
const TRIGGER_LABELS: Record<RulesV2.TriggerKind, string> = {
  [RulesV2.TriggerKind.EveryTime]: 'Every time',
  [RulesV2.TriggerKind.Once]: 'Once',
  [RulesV2.TriggerKind.OncePerBar]: 'Once per bar',
  [RulesV2.TriggerKind.OncePerBarOpen]: 'Once per bar open',
  [RulesV2.TriggerKind.OncePerBarClose]: 'Once per bar close',
  [RulesV2.TriggerKind.OncePerInterval]: 'Once per interval',
};

/**
 * The v2 trigger-gate picker — owns the trigger-kind dropdown plus the
 * conditional `period` / `intervalMs` sub-fields:
 *
 * - `OncePerBar` / `OncePerBarOpen` / `OncePerBarClose` reveal a `Period`
 *   dropdown.
 * - `OncePerInterval` reveals an integer-ms input.
 *
 * Receives the form's `control` and wires sub-fields via {@link Controller}.
 */
export function TriggerPickerV2({ control }: { control: Control<RuleV2FormValues> }): ReactNode {
  return (
    <Controller
      name="triggerKind"
      control={control}
      render={({ field: kindField }) => (
        <Flex direction="column" gap="2">
          <Select.Root
            value={kindField.value}
            onValueChange={(next) => kindField.onChange(next as RulesV2.TriggerKind)}
          >
            <Select.Trigger aria-label="Trigger" />
            <Select.Content>
              {Object.values(RulesV2.TriggerKind).map((value) => (
                <Select.Item key={value} value={value}>
                  {TRIGGER_LABELS[value]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>

          {isBarBasedTriggerV2(kindField.value) && (
            <Controller
              name="triggerPeriod"
              control={control}
              render={({ field, fieldState: { error } }) => {
                const periodErrorId = error?.message ? 'rule-v2-trigger-period-error' : undefined;
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

          {kindField.value === RulesV2.TriggerKind.OncePerInterval && (
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
