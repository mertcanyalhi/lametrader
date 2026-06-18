import type { Profile } from '@lametrader/core';
import { AlertDialog, Button, Flex } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { useDeleteProfile } from '../../lib/hooks/profiles.js';
import { getLogger } from '../../lib/log.js';

/** Scoped logger for the delete-profile flow. */
const log = getLogger('delete-profile-dialog');

/**
 * Confirmation dialog for deleting a profile. On confirm it issues
 * `DELETE /profiles/:id` and toasts; the selector's reconciliation falls the
 * selection back to the first remaining enabled profile when the deleted one
 * was selected.
 *
 * Uses a plain confirm `Button` (not `AlertDialog.Action`) so the dialog closes
 * after the mutation resolves, not on click.
 *
 * @param open - controlled open state.
 * @param onOpenChange - controlled open-state setter.
 * @param profile - the profile to delete.
 */
export function DeleteProfileDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile;
}): ReactNode {
  const remove = useDeleteProfile();

  async function handleDelete(): Promise<void> {
    try {
      await remove.mutateAsync(profile.id);
      toast.success(`Deleted ${profile.name}`);
      onOpenChange(false);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to delete profile';
      log.warn({ err: cause, id: profile.id }, 'delete profile failed');
      toast.error(message);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Delete profile</AlertDialog.Title>
        <AlertDialog.Description size="2">
          Delete “{profile.name}”? This can’t be undone.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <Button
            color="red"
            onClick={handleDelete}
            disabled={remove.isPending}
            loading={remove.isPending}
          >
            Delete
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
