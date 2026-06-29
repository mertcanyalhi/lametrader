import { Period, type Trigger, TriggerKind } from '@lametrader/core';
import { Flex, Select, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/**
 * Human-readable label for each {@link TriggerKind}.
 *
 * Surfaced in the trigger picker and (later) in the rule-list table.
 */
export const TRIGGER_KIND_LABELS: Readonly<Record<TriggerKind, string>> = {
  [TriggerKind.EveryTime]: 'Every time',
  [TriggerKind.Once]: 'Once',
  [TriggerKind.OncePerBar]: 'Once per bar',
  [TriggerKind.OncePerBarOpen]: 'Once per bar (open)',
  [TriggerKind.OncePerBarClose]: 'Once per bar (close)',
  [TriggerKind.OncePerInterval]: 'Once per interval',
};

/**
 * Human-readable label for each {@link Period}.
 *
 * The persisted tag is the short form (`1m`, `1h`, …); the label adds the unit
 * so the dropdown reads cleanly.
 */
export const PERIOD_LABELS: Readonly<Record<Period, string>> = {
  [Period.OneMinute]: '1 minute',
  [Period.FiveMinutes]: '5 minutes',
  [Period.FifteenMinutes]: '15 minutes',
  [Period.ThirtyMinutes]: '30 minutes',
  [Period.OneHour]: '1 hour',
  [Period.FourHours]: '4 hours',
  [Period.OneDay]: '1 day',
  [Period.OneWeek]: '1 week',
};

/**
 * Whether a trigger kind needs the row's `period` (bar-cadence triggers).
 */
export function triggerNeedsPeriod(kind: TriggerKind): boolean {
  return (
    kind === TriggerKind.OncePerBar ||
    kind === TriggerKind.OncePerBarOpen ||
    kind === TriggerKind.OncePerBarClose
  );
}

/**
 * Whether a trigger kind needs the row's `intervalMs` (periodic-cadence).
 */
export function triggerNeedsIntervalMs(kind: TriggerKind): boolean {
  return kind === TriggerKind.OncePerInterval;
}

/**
 * The trigger picker — picks one of the six {@link TriggerKind}s and,
 * when the kind needs one, the per-kind `period` or `intervalMs` field.
 *
 * Emits a fully-shaped `Trigger` value the form schema accepts on save.
 */
export function TriggerPicker({
  value,
  onChange,
}: {
  value: Trigger;
  onChange: (next: Trigger) => void;
}): ReactNode {
  return (
    <Flex direction="column" gap="2">
      <Select.Root
        value={value.kind}
        onValueChange={(next) => onChange(triggerFromKind(next as TriggerKind, value))}
      >
        <Select.Trigger aria-label="Trigger kind" />
        <Select.Content>
          {Object.values(TriggerKind).map((kind) => (
            <Select.Item key={kind} value={kind}>
              {TRIGGER_KIND_LABELS[kind]}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      {triggerNeedsPeriod(value.kind) ? (
        <Flex gap="2" align="center">
          <Text size="2" color="gray">
            Period
          </Text>
          <Select.Root
            value={'period' in value && typeof value.period === 'string' ? value.period : undefined}
            onValueChange={(next) => onChange(triggerWithPeriod(value, next as Period))}
          >
            <Select.Trigger aria-label="Trigger period" placeholder="Pick a period" />
            <Select.Content>
              {Object.values(Period).map((period) => (
                <Select.Item key={period} value={period}>
                  {PERIOD_LABELS[period]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      ) : null}
      {triggerNeedsIntervalMs(value.kind) ? (
        <Flex gap="2" align="center">
          <Text size="2" color="gray">
            Interval (ms)
          </Text>
          <TextField.Root
            aria-label="Trigger interval ms"
            type="number"
            inputMode="numeric"
            min={1}
            value={'intervalMs' in value ? value.intervalMs : 0}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({
                kind: TriggerKind.OncePerInterval,
                intervalMs: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
              });
            }}
          />
        </Flex>
      ) : null}
    </Flex>
  );
}

/**
 * Build a fresh trigger for a kind change, preserving any per-kind fields that
 * carry over (`period` between bar-cadence kinds; `intervalMs` only used by
 * `OncePerInterval` so it doesn't carry).
 */
function triggerFromKind(kind: TriggerKind, prev: Trigger): Trigger {
  switch (kind) {
    case TriggerKind.EveryTime:
    case TriggerKind.Once:
      return { kind };
    case TriggerKind.OncePerBar:
    case TriggerKind.OncePerBarOpen:
    case TriggerKind.OncePerBarClose: {
      const prevPeriod = 'period' in prev ? prev.period : Period.OneHour;
      return { kind, period: prevPeriod };
    }
    case TriggerKind.OncePerInterval: {
      const prevInterval = 'intervalMs' in prev ? prev.intervalMs : 60_000;
      return { kind, intervalMs: prevInterval };
    }
  }
}

/**
 * Replace `period` on a bar-cadence trigger, leaving `intervalMs`-cadence
 * triggers unchanged.
 */
function triggerWithPeriod(prev: Trigger, period: Period): Trigger {
  if (
    prev.kind === TriggerKind.OncePerBar ||
    prev.kind === TriggerKind.OncePerBarOpen ||
    prev.kind === TriggerKind.OncePerBarClose
  ) {
    return { ...prev, period };
  }
  return prev;
}
