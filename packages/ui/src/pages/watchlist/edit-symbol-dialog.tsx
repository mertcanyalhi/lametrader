import type { Period, SymbolType } from '@lametrader/core';
import { Button, Dialog, Flex } from '@radix-ui/themes';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FieldLabel } from '../../components/field-label.js';
import { PeriodToggleGroup } from '../../components/period-toggle-group.js';
import { SymbolIdCode } from '../../components/symbol-type-badge.js';
import { ApiError } from '../../lib/api-fetch.js';
import { useUpdatePeriods } from '../../lib/hooks/symbols.js';
import { getLogger } from '../../lib/log.js';
import { sortPeriods } from '../../lib/periods.js';

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

  const periodOptions = sortPeriods(availablePeriods.length > 0 ? availablePeriods : periods);

  // Re-seed the form each time the dialog opens (so a cancelled edit doesn't
  // leak into the next one), pre-selecting only periods still offered. A period
  // the symbol watches but config no longer enables is not shown as a toggle,
  // so seeding it would leave it selected-but-invisible and the server would
  // reject the save ("period X is not enabled in config"); dropping it here
  // heals the symbol to a valid set on the next save.
  useEffect(() => {
    if (!open) return;
    const offered = availablePeriods.length > 0 ? availablePeriods : periods;
    setSelectedPeriods(periods.filter((period) => offered.includes(period)));
  }, [open, periods, availablePeriods]);

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
          <section className="flex flex-col gap-2">
            <FieldLabel
              htmlFor="edit-periods-bar"
              label="Periods"
              hintLabel="About the periods setting"
              hint="The candle timeframes tracked for this symbol (for example 1h, 1d). Toggle a timeframe on to start tracking it."
            />
            <PeriodToggleGroup
              id="edit-periods-bar"
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
