import { AlertDialog, Button, Code, Flex, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { useRemoveSymbol } from '../../lib/hooks/symbols.js';
import { getLogger } from '../../lib/log.js';

/** Scoped logger for the remove flow. */
const log = getLogger('remove-symbol-dialog');

/**
 * The remove-confirmation flow for one row: a controlled `AlertDialog` (opened
 * from the row's actions menu) that names the symbol and, on confirm, issues
 * `DELETE /symbols/:id` and surfaces a success/error toast.
 *
 * @param id - the symbol to remove.
 * @param open - controlled open state.
 * @param onOpenChange - controlled open-state setter.
 */
export function RemoveSymbolDialog({
  id,
  open,
  onOpenChange,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const remove = useRemoveSymbol();

  async function handleConfirm(): Promise<void> {
    try {
      await remove.mutateAsync(id);
      toast.success(`Removed ${id}`);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to remove symbol';
      log.warn({ err: cause, id }, 'remove symbol failed');
      toast.error(message);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Remove symbol</AlertDialog.Title>
        <AlertDialog.Description size="2">
          <Text>
            Stop watching <Code>{id}</Code>? Its stored candles are removed too. This can’t be
            undone.
          </Text>
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={handleConfirm} loading={remove.isPending}>
              Remove
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
