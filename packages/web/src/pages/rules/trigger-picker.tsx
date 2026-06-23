import { Period, TriggerKind } from '@lametrader/core';
import { Box, Flex, RadioGroup, Select, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/** Human label for every trigger kind — used as the radio option text. */
const TRIGGER_LABELS: Record<TriggerKind, string> = {
  [TriggerKind.Once]: 'Once',
  [TriggerKind.OncePerBar]: 'Once per bar',
  [TriggerKind.OncePerBarClose]: 'Once per bar close',
  [TriggerKind.OncePerMinute]: 'Once per interval',
};

/**
 * The trigger-gate picker for the rule editor. A radio over the four trigger
 * kinds plus the variant-specific extra control — a bar-size dropdown for
 * the bar-based triggers, a milliseconds input for `OncePerMinute`.
 *
 * The schema (see `ruleFormSchema`) enforces "period required for bar-based
 * variants"; this component just renders the inputs that feed those fields.
 *
 * @param kind         - Current trigger kind.
 * @param onKindChange - Receives the next kind on selection.
 * @param period       - The bar size (empty when not in a bar-based mode).
 * @param onPeriodChange - Receives the next period.
 * @param intervalMs   - The interval for `OncePerMinute`.
 * @param onIntervalMsChange - Receives the next interval (ms).
 * @param periodError  - Inline period validation message, if any.
 */
export function TriggerPicker({
  kind,
  onKindChange,
  period,
  onPeriodChange,
  intervalMs,
  onIntervalMsChange,
  periodError,
}: {
  kind: TriggerKind;
  onKindChange: (next: TriggerKind) => void;
  period: Period | '';
  onPeriodChange: (next: Period | '') => void;
  intervalMs: number;
  onIntervalMsChange: (next: number) => void;
  periodError: string | undefined;
}): ReactNode {
  const periodErrorId = periodError ? 'rule-trigger-period-error' : undefined;
  return (
    <Flex direction="column" gap="2">
      <RadioGroup.Root
        value={kind}
        onValueChange={(next) => onKindChange(next as TriggerKind)}
        aria-label="Trigger"
      >
        <RadioGroup.Item value={TriggerKind.Once}>
          {TRIGGER_LABELS[TriggerKind.Once]}
        </RadioGroup.Item>
        <RadioGroup.Item value={TriggerKind.OncePerBar}>
          {TRIGGER_LABELS[TriggerKind.OncePerBar]}
        </RadioGroup.Item>
        <RadioGroup.Item value={TriggerKind.OncePerBarClose}>
          {TRIGGER_LABELS[TriggerKind.OncePerBarClose]}
        </RadioGroup.Item>
        <RadioGroup.Item value={TriggerKind.OncePerMinute}>
          {TRIGGER_LABELS[TriggerKind.OncePerMinute]}
        </RadioGroup.Item>
      </RadioGroup.Root>
      {kind === TriggerKind.OncePerBar || kind === TriggerKind.OncePerBarClose ? (
        <Box>
          <Select.Root
            value={period === '' ? undefined : period}
            onValueChange={(next) => onPeriodChange(next as Period)}
          >
            <Select.Trigger
              placeholder="Pick a period"
              aria-label="Trigger period"
              aria-invalid={periodError ? true : undefined}
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
          {periodError ? (
            <Text id={periodErrorId} role="alert" color="red" size="1">
              {periodError}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {kind === TriggerKind.OncePerMinute ? (
        <Box>
          <TextField.Root
            type="number"
            aria-label="Trigger interval (ms)"
            value={Number.isFinite(intervalMs) ? String(intervalMs) : ''}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              onIntervalMsChange(Number.isFinite(parsed) ? parsed : 0);
            }}
          />
        </Box>
      ) : null}
    </Flex>
  );
}
