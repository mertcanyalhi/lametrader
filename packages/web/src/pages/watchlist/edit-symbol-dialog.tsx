import type { Period, SymbolType } from '@lametrader/core';
import { Button, Dialog, Flex, Text } from '@radix-ui/themes';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PeriodToggleGroup } from '../../components/period-toggle-group.js';
import { ApiError } from '../../lib/api-fetch.js';
import { useUpdatePeriods } from '../../lib/hooks/symbols.js';
import { getLogger } from '../../lib/log.js';
import { sortPeriods } from '../../lib/periods.js';
import { SymbolIdCode } from './symbol-type-badge.js';

/** Scoped logger for the edit-symbol flow. */
const log = getLogger('edit-symbol-dialog');

/**
 * The per-symbol edit modal, opened from the row's Edit action. A generic
 * "edit symbol" dialog whose body is a stack of sections — today just the
 * **Periods** section, structured so future editable facets (display name,
 * alerts, …) drop in as additional sections sharing the one Save.
 *
 * Saving currently issues `PATCH /symbols/:id` with the chosen periods (sorted
 * into timeframe order) and surfaces a success/error toast. Controlled by the
 * row; opening re-seeds the form from the symbol's current values.
 *
 * @param id - the symbol being edited.
 * @param type - the symbol's asset class (for the colour-coded id label).
 * @param periods - the symbol's current watched periods.
 * @param availablePeriods - the platform's enabled periods (toggle options).
 * @param open - controlled open state.
 * @param onOpenChange - controlled open-state setter.
 */
export function EditSymbolDialog({
  id,
  type,
  periods,
  availablePeriods,
  open,
  onOpenChange,
}: {
  id: string;
  type: SymbolType;
  periods: Period[];
  availablePeriods: Period[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const update = useUpdatePeriods();
  const [selectedPeriods, setSelectedPeriods] = useState<Period[]>(periods);

  // Re-seed the form from the symbol's values each time the dialog opens so a
  // cancelled edit doesn't leak into the next one.
  useEffect(() => {
    if (open) setSelectedPeriods(periods);
  }, [open, periods]);

  const periodOptions = sortPeriods(availablePeriods.length > 0 ? availablePeriods : periods);

  async function handleSave(): Promise<void> {
    try {
      await update.mutateAsync({ id, periods: sortPeriods(selectedPeriods) });
      toast.success(`Updated periods for ${id}`);
      onOpenChange(false);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to update symbol';
      log.warn({ err: cause, id }, 'update symbol failed');
      toast.error(message);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="460px">
        <Dialog.Title>Edit symbol</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Update settings for <SymbolIdCode id={id} type={type} />.
        </Dialog.Description>

        <Flex direction="column" gap="5" mt="4">
          <section>
            <Text as="div" size="2" weight="medium" mb="1">
              Periods
            </Text>
            <Text as="p" size="1" color="gray" mb="2">
              The timeframes tracked for this symbol.
            </Text>
            <PeriodToggleGroup
              options={periodOptions}
              value={selectedPeriods}
              disabled={update.isPending}
              onValueChange={setSelectedPeriods}
            />
          </section>
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSave}
            disabled={selectedPeriods.length === 0 || update.isPending}
            loading={update.isPending}
          >
            Save
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
