import type { Profile } from '@lametrader/core';
import { Button, Dialog, Flex, Text } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import { useProfiles } from '../../lib/hooks/profiles.js';
import { DeleteProfileDialog } from './delete-profile-dialog.js';
import { ProfileFormDialog } from './profile-form-dialog.js';

/**
 * The dedicated profile-management dialog, opened from the status bar: a list of
 * every profile with per-row Edit / Delete, plus a "New profile" action. Create
 * and edit share {@link ProfileFormDialog}; delete uses {@link DeleteProfileDialog}.
 *
 * @param open - controlled open state.
 * @param onOpenChange - controlled open-state setter.
 */
export function ManageProfilesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { data } = useProfiles();
  const profiles = data ?? [];
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | undefined>(undefined);
  const [deleting, setDeleting] = useState<Profile | null>(null);

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>Manage profiles</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            Create, edit, or delete your profiles.
          </Dialog.Description>

          <Flex direction="column" gap="2" mt="4">
            {profiles.length === 0 ? (
              <Text size="2" color="gray">
                No profiles yet.
              </Text>
            ) : (
              profiles.map((profile) => (
                <Flex
                  key={profile.id}
                  align="center"
                  justify="between"
                  gap="3"
                  className="rounded-md border border-border px-3 py-2"
                >
                  <Text size="2">
                    {profile.name}
                    {profile.enabled ? null : (
                      <Text color="gray" size="1">
                        {' '}
                        (disabled)
                      </Text>
                    )}
                  </Text>
                  <Flex gap="2">
                    <Button
                      variant="soft"
                      size="1"
                      aria-label={`Edit ${profile.name}`}
                      onClick={() => {
                        setEditing(profile);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="soft"
                      color="red"
                      size="1"
                      aria-label={`Delete ${profile.name}`}
                      onClick={() => setDeleting(profile)}
                    >
                      Delete
                    </Button>
                  </Flex>
                </Flex>
              ))
            )}
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                Close
              </Button>
            </Dialog.Close>
            <Button
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              New profile
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <ProfileFormDialog open={formOpen} onOpenChange={setFormOpen} profile={editing} />
      {deleting ? (
        <DeleteProfileDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) setDeleting(null);
          }}
          profile={deleting}
        />
      ) : null}
    </>
  );
}
