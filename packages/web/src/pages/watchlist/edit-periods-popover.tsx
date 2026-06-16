import type { Period } from '@lametrader/core';
import { Badge, Button, Flex, Popover, Text } from '@radix-ui/themes';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PeriodToggleGroup } from '../../components/period-toggle-group.js';
import { ApiError } from '../../lib/api-fetch.js';
import { useUpdatePeriods } from '../../lib/hooks/symbols.js';
import { getLogger } from '../../lib/log.js';
import { sortPeriods } from '../../lib/periods.js';

/** Scoped logger for the edit-periods flow. */
const log = getLogger('edit-periods-popover');

/**
 * The watched-period editor for one row: a button showing the current period
 * chips that opens a popover with a timeframe toggle bar over the platform's
 * available periods. Saving issues `PATCH /symbols/:id` with the selection
 * (sorted into timeframe order) and surfaces a success/error toast.
 *
 * The popover is controlled so the row's actions menu can open it too. Opening
 * re-seeds the selection from the symbol's current periods.
 *
 * @param id - the symbol whose periods are edited.
 * @param periods - the symbol's current watched periods.
 * @param availablePeriods - the platform's enabled periods (toggle options).
 * @param open - controlled open state.
 * @param onOpenChange - controlled open-state setter.
 */
export function EditPeriodsPopover({
  id,
  periods,
  availablePeriods,
  open,
  onOpenChange,
}: {
  id: string;
  periods: Period[];
  availablePeriods: Period[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const update = useUpdatePeriods();
  const [selected, setSelected] = useState<Period[]>(periods);

  // Re-seed the selection from the symbol's periods each time the popover opens
  // so a cancelled edit doesn't leak into the next one.
  useEffect(() => {
    if (open) setSelected(periods);
  }, [open, periods]);

  const options = sortPeriods(availablePeriods.length > 0 ? availablePeriods : periods);

  async function handleSave(): Promise<void> {
    try {
      await update.mutateAsync({ id, periods: sortPeriods(selected) });
      toast.success(`Updated periods for ${id}`);
      onOpenChange(false);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to update periods';
      log.warn({ err: cause, id }, 'update periods failed');
      toast.error(message);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger>
        <button
          type="button"
          aria-label={`Edit periods for ${id}`}
          className="inline-flex flex-wrap gap-1 rounded-md p-1 hover:bg-[var(--gray-a3)]"
        >
          {periods.length === 0 ? (
            <Text color="gray" size="1">
              —
            </Text>
          ) : (
            sortPeriods(periods).map((period) => (
              <Badge key={period} variant="soft" radius="full">
                {period}
              </Badge>
            ))
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content size="2" maxWidth="320px">
        <Flex direction="column" gap="3">
          <Text size="2" weight="medium">
            Watched periods
          </Text>
          <PeriodToggleGroup
            options={options}
            value={selected}
            disabled={update.isPending}
            onValueChange={setSelected}
          />
          <Flex justify="end" gap="2">
            <Button
              onClick={handleSave}
              disabled={selected.length === 0 || update.isPending}
              loading={update.isPending}
            >
              Save periods
            </Button>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
