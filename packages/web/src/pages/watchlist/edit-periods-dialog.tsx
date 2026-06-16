import type { Period } from '@lametrader/core';
import { Button, Code, Dialog, Flex, Text } from '@radix-ui/themes';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PeriodToggleGroup } from '../../components/period-toggle-group.js';
import { ApiError } from '../../lib/api-fetch.js';
import { useUpdatePeriods } from '../../lib/hooks/symbols.js';
import { getLogger } from '../../lib/log.js';
import { sortPeriods } from '../../lib/periods.js';

/** Scoped logger for the edit-periods flow. */
const log = getLogger('edit-periods-dialog');

/**
 * The watched-period editor for one row: a modal dialog (opened from the row's
 * Edit action) with a timeframe toggle bar over the platform's available
 * periods. Saving issues `PATCH /symbols/:id` with the selection (sorted into
 * timeframe order) and surfaces a success/error toast.
 *
 * Controlled by the row so its actions menu drives it. Opening re-seeds the
 * selection from the symbol's current periods.
 *
 * @param id - the symbol whose periods are edited.
 * @param periods - the symbol's current watched periods.
 * @param availablePeriods - the platform's enabled periods (toggle options).
 * @param open - controlled open state.
 * @param onOpenChange - controlled open-state setter.
 */
export function EditPeriodsDialog({
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

  // Re-seed the selection from the symbol's periods each time the dialog opens
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="420px">
        <Dialog.Title>Edit watched periods</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Choose the timeframes tracked for <Code>{id}</Code>.
        </Dialog.Description>

        <div className="mt-4">
          <PeriodToggleGroup
            options={options}
            value={selected}
            disabled={update.isPending}
            onValueChange={setSelected}
          />
        </div>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSave}
            disabled={selected.length === 0 || update.isPending}
            loading={update.isPending}
          >
            Save periods
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
