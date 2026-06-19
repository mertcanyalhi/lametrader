import type { IndicatorInstance, Profile } from '@lametrader/core';
import { AlertDialog, Button, Flex, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../../lib/api-fetch.js';
import { useDetachIndicator } from '../../../lib/hooks/indicators.js';
import { getLogger } from '../../../lib/log.js';

/** Scoped logger for the detach mutation. */
const log = getLogger('detach-indicator-dialog');

/**
 * Detach confirmation `AlertDialog`. Controlled by the parent — the parent
 * owns the `instance` being detached and decides what to do after the
 * DELETE returns (currently just closes the alert; the row disappears via
 * the profiles-query invalidation).
 *
 * Lives on its own so both the indicator panel's row delete and the chart
 * legend's remove `x` can share one confirm flow.
 */
export function DetachIndicatorDialog({
  profile,
  instance,
  definitionName,
  onOpenChange,
  onDetached,
}: {
  profile: Profile;
  instance: IndicatorInstance;
  definitionName: string;
  onOpenChange: (open: boolean) => void;
  onDetached: () => void;
}): ReactNode {
  const detach = useDetachIndicator(profile.id);

  async function handleConfirm(): Promise<void> {
    try {
      await detach.mutateAsync(instance.id);
      toast.success(`Detached ${definitionName}`);
      onDetached();
      onOpenChange(false);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to detach indicator';
      log.warn({ err: cause, instanceId: instance.id }, 'detach indicator failed');
      toast.error(message);
    }
  }

  return (
    <AlertDialog.Root open={true} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Detach indicator</AlertDialog.Title>
        <AlertDialog.Description size="2">
          <Text>
            Detach “{definitionName}” from “{profile.name}”?
          </Text>
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          {/* NOT wrapped in `AlertDialog.Action`: Action's default `onSelect`
              dispatches a click that bubbles through Radix's portal stack and
              also closes the *parent* Dialog (the panel itself).
              Instead, drive the close ourselves from `handleConfirm` so only
              this AlertDialog dismisses — the panel stays open. */}
          <Button color="red" onClick={handleConfirm} loading={detach.isPending}>
            Detach
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
