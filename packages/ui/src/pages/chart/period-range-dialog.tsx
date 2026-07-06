import type { Period } from '@lametrader/core';
import { Button, Dialog, Flex, Text } from '@radix-ui/themes';
import { Clock } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '../../lib/cn.js';
import { PERIOD_ORDER } from '../../lib/periods.js';
import { CHART_RANGE_ORDER, type ChartRange, rangeLabel } from './chart-range.js';

/** Common pill style for both the range and period chips. */
const CHIP = cn(
  'inline-flex h-8 min-w-12 items-center justify-center rounded-md px-3 text-sm',
  'border border-[var(--gray-a6)] bg-[var(--color-surface)] text-[var(--gray-12)]',
  'enabled:hover:bg-[var(--gray-a3)]',
  'disabled:cursor-not-allowed disabled:opacity-40',
  "aria-[pressed='true']:border-[var(--accent-9)] aria-[pressed='true']:bg-[var(--accent-9)] aria-[pressed='true']:text-[var(--accent-contrast)]",
);

/**
 * The chart's period + range selector — a trigger button labeled with the
 * current period (and range, when set) that opens a dialog with two sections:
 * a row of date-range presets (`1D … All`) and the symbol's watched periods.
 * Confirming the dialog hands both values back via `onApply`; the chart page
 * routes them into the URL as `?period=&range=`.
 *
 * @param period - the period currently shown on the chart.
 * @param range - the active range preset, or `null` when none is selected.
 * @param watchedPeriods - the symbol's watched periods (others are disabled).
 * @param onApply - called once with `{ period, range }` when the user confirms.
 */
export function PeriodRangeDialog({
  period,
  range,
  watchedPeriods,
  onApply,
  disabled = false,
}: {
  period: Period;
  range: ChartRange | null;
  watchedPeriods: Period[];
  onApply: (next: { period: Period; range: ChartRange | null }) => void;
  /** When `true`, the trigger is locked (e.g. while a backtest run is active). */
  disabled?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [draftPeriod, setDraftPeriod] = useState<Period>(period);
  const [draftRange, setDraftRange] = useState<ChartRange | null>(range);

  // Re-seed the draft from the live props each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setDraftPeriod(period);
    setDraftRange(range);
  }, [open, period, range]);

  function handleApply(): void {
    onApply({ period: draftPeriod, range: draftRange });
    setOpen(false);
  }

  const triggerLabel = range ? `${period} · ${rangeLabel(range)}` : period;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button variant="soft" color="gray" className="min-w-32 justify-center" disabled={disabled}>
          <Clock size={14} aria-hidden="true" />
          {triggerLabel}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Period &amp; range</Dialog.Title>

        <Flex direction="column" gap="4" mt="4">
          <section>
            <Text as="p" size="2" weight="medium" mb="2">
              Date range
            </Text>
            <Flex gap="2" wrap="wrap">
              {CHART_RANGE_ORDER.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draftRange === value}
                  onClick={() => setDraftRange(value)}
                  className={CHIP}
                >
                  {rangeLabel(value)}
                </button>
              ))}
            </Flex>
          </section>

          <section>
            <Text as="p" size="2" weight="medium" mb="2">
              Period
            </Text>
            <Flex gap="2" wrap="wrap">
              {PERIOD_ORDER.map((value) => {
                const enabled = watchedPeriods.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={draftPeriod === value}
                    disabled={!enabled}
                    onClick={() => setDraftPeriod(value)}
                    className={CHIP}
                  >
                    {value}
                  </button>
                );
              })}
            </Flex>
          </section>
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          <Button onClick={handleApply}>Apply</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
