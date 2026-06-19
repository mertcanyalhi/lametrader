import { type Profile, type ProfileFields, ProfileScope } from '@lametrader/core';
import {
  AlertDialog,
  Box,
  Button,
  Dialog,
  Flex,
  IconButton,
  ScrollArea,
  Switch,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { Pencil, Plus, Trash2, User } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import {
  useCreateProfile,
  useDeleteProfile,
  useProfiles,
  useUpdateProfile,
} from '../../lib/hooks/profiles.js';
import { getLogger } from '../../lib/log.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';

/** Scoped logger for picker lifecycle / mutation failures. */
const log = getLogger('profile-picker');

/**
 * What's currently rendered inside the picker dialog: the list of profiles,
 * the create form, or the edit form (carrying the profile being edited).
 */
type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; profile: Profile };

/**
 * The chart's bottom-bar profile selector. A trigger button labeled with the
 * active profile's name (or "No profile") opens a single modal that handles
 * both **selecting** a profile and **managing** them (create / edit / delete).
 * No URL state — the selection lives in {@link useSelectedProfile} and is
 * persisted to `localStorage` by the provider.
 *
 * Modeled on `symbol-picker-dialog.tsx`. The delete confirmation is a nested
 * `AlertDialog` (per project rule "Confirmation prompt → `<AlertDialog>`").
 */
export function ProfilePickerDialog(): ReactNode {
  const { profileId, setProfileId } = useSelectedProfile();
  const profilesQuery = useProfiles();
  const profiles = profilesQuery.data ?? [];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [toDelete, setToDelete] = useState<Profile | null>(null);

  // First-run defaulting: when nothing is stored and profiles exist, pick the
  // first enabled one. A stored id missing from the loaded list is left in
  // storage (treated as stale → trigger reads "No profile") so it isn't
  // proactively wiped — only overwritten when the user makes a new selection.
  useEffect(() => {
    if (!profilesQuery.isSuccess) return;
    if (profileId !== null) return;
    const fallback = profiles.find((profile) => profile.enabled) ?? null;
    if (fallback !== null) setProfileId(fallback.id);
  }, [profilesQuery.isSuccess, profiles, profileId, setProfileId]);

  const selected = profiles.find((profile) => profile.id === profileId) ?? null;
  const triggerLabel = selected?.name ?? 'No profile';

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) setView({ kind: 'list' });
  }

  function handleSelect(profile: Profile): void {
    setProfileId(profile.id);
    handleOpenChange(false);
  }

  function handleCreated(profile: Profile): void {
    setProfileId(profile.id);
    handleOpenChange(false);
  }

  function handleEdited(): void {
    handleOpenChange(false);
  }

  async function handleDeleted(profile: Profile): Promise<void> {
    // Selection fallback: when the deleted profile was selected, pick the
    // first remaining enabled profile (or clear when none).
    if (profileId === profile.id) {
      const remaining = profiles.filter((p) => p.id !== profile.id);
      const fallback = remaining.find((p) => p.enabled) ?? null;
      setProfileId(fallback?.id ?? null);
    }
    handleOpenChange(false);
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Trigger>
          <Button variant="soft" color="gray">
            <User size={14} aria-hidden="true" />
            {triggerLabel}
          </Button>
        </Dialog.Trigger>
        <Dialog.Content maxWidth="480px">
          {view.kind === 'list' ? (
            <ProfileList
              profiles={profiles}
              onSelect={handleSelect}
              onCreate={() => setView({ kind: 'create' })}
              onEdit={(profile) => setView({ kind: 'edit', profile })}
              onDelete={(profile) => setToDelete(profile)}
            />
          ) : view.kind === 'create' ? (
            <ProfileForm
              mode="create"
              onCancel={() => setView({ kind: 'list' })}
              onCreated={handleCreated}
              onEdited={handleEdited}
            />
          ) : (
            <ProfileForm
              mode="edit"
              profile={view.profile}
              onCancel={() => setView({ kind: 'list' })}
              onCreated={handleCreated}
              onEdited={handleEdited}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>
      {toDelete ? (
        <DeleteProfileDialog
          profile={toDelete}
          onOpenChange={(next) => {
            if (!next) setToDelete(null);
          }}
          onDeleted={handleDeleted}
        />
      ) : null}
    </>
  );
}

/**
 * The list view inside the picker: a "New profile…" entry at the top, then
 * one row per profile with row-click select + edit / delete icon buttons.
 */
function ProfileList({
  profiles,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
}: {
  profiles: Profile[];
  onSelect: (profile: Profile) => void;
  onCreate: () => void;
  onEdit: (profile: Profile) => void;
  onDelete: (profile: Profile) => void;
}): ReactNode {
  return (
    <>
      <Dialog.Title>Profiles</Dialog.Title>
      <Dialog.Description size="2" color="gray">
        Manage profiles or pick one to use on this chart.
      </Dialog.Description>
      <Flex direction="column" gap="1" mt="4">
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-[var(--gray-a3)]"
        >
          <Plus size={14} aria-hidden="true" />
          <Text size="2">New profile…</Text>
        </button>
        <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '22rem' }}>
          <Flex direction="column" gap="1">
            {profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                onSelect={onSelect}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </Flex>
        </ScrollArea>
      </Flex>
    </>
  );
}

/**
 * One row in the list: the row body is a `<button>` that selects the profile,
 * with sibling edit/delete icon buttons that open the corresponding flow
 * without closing the picker.
 */
function ProfileRow({
  profile,
  onSelect,
  onEdit,
  onDelete,
}: {
  profile: Profile;
  onSelect: (profile: Profile) => void;
  onEdit: (profile: Profile) => void;
  onDelete: (profile: Profile) => void;
}): ReactNode {
  return (
    <Flex align="center" gap="2" className="rounded-md hover:bg-[var(--gray-a3)]">
      <button
        type="button"
        onClick={() => onSelect(profile)}
        aria-label={`Select ${profile.name}`}
        className="flex flex-1 items-center gap-2 px-3 py-2 text-left"
      >
        <Text size="2">{profile.name}</Text>
        {profile.enabled ? null : (
          <Text size="1" color="gray">
            disabled
          </Text>
        )}
      </button>
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        aria-label={`Edit ${profile.name}`}
        onClick={() => onEdit(profile)}
      >
        <Pencil size={14} aria-hidden="true" />
      </IconButton>
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        aria-label={`Delete ${profile.name}`}
        onClick={() => onDelete(profile)}
      >
        <Trash2 size={14} aria-hidden="true" />
      </IconButton>
    </Flex>
  );
}

/**
 * The create / edit form (rendered inside the picker dialog as a swap from
 * the list view). On create, the chosen `scope` defaults to {@link ProfileScope.All};
 * on edit, only name/description/enabled are sent (via `PATCH /profiles/:id`)
 * so the server preserves `scope` and `indicators`.
 *
 * Surfaces a `409` (duplicate name) inline under the name field; other errors
 * surface as a `toast.error`.
 */
function ProfileForm({
  mode,
  profile,
  onCancel,
  onCreated,
  onEdited,
}: {
  mode: 'create' | 'edit';
  profile?: Profile;
  onCancel: () => void;
  onCreated: (profile: Profile) => void;
  onEdited: () => void;
}): ReactNode {
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const [name, setName] = useState(profile?.name ?? '');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [enabled, setEnabled] = useState(profile?.enabled ?? true);
  const [nameError, setNameError] = useState<string | null>(null);
  const submitting = create.isPending || update.isPending;

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setNameError(null);
    if (mode === 'create') {
      const fields: ProfileFields = {
        name,
        description,
        enabled,
        scope: { type: ProfileScope.All },
      };
      try {
        const created = await create.mutateAsync(fields);
        toast.success(`Created ${created.name}`);
        onCreated(created);
      } catch (cause) {
        handleError(cause, 'failed to create profile');
      }
      return;
    }
    if (!profile) return;
    try {
      const saved = await update.mutateAsync({
        id: profile.id,
        patch: { name, description, enabled },
      });
      toast.success(`Saved ${saved.name}`);
      onEdited();
    } catch (cause) {
      handleError(cause, 'failed to save profile');
    }
  }

  function handleError(cause: unknown, fallbackMessage: string): void {
    log.warn({ err: cause, mode }, fallbackMessage);
    if (cause instanceof ApiError && cause.status === 409) {
      setNameError(cause.message);
      return;
    }
    const message = cause instanceof ApiError ? cause.message : fallbackMessage;
    toast.error(message);
  }

  const title = mode === 'create' ? 'New profile' : `Edit ${profile?.name ?? ''}`;
  const submitLabel = mode === 'create' ? 'Create' : 'Save';
  const nameErrorId = nameError ? 'profile-name-error' : undefined;

  return (
    <form onSubmit={handleSubmit}>
      <Dialog.Title>{title}</Dialog.Title>
      <Flex direction="column" gap="3" mt="4">
        <Box>
          <Text as="label" htmlFor="profile-name" size="2" weight="medium">
            Name
          </Text>
          <TextField.Root
            id="profile-name"
            aria-label="Name"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameErrorId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
          />
          {nameError ? (
            <Text id={nameErrorId} role="alert" color="red" size="1">
              {nameError}
            </Text>
          ) : null}
        </Box>
        <Box>
          <Text as="label" htmlFor="profile-description" size="2" weight="medium">
            Description
          </Text>
          <TextArea
            id="profile-description"
            aria-label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Box>
        <Flex align="center" gap="2">
          <Switch
            id="profile-enabled"
            checked={enabled}
            onCheckedChange={(next) => setEnabled(next === true)}
          />
          <Text as="label" htmlFor="profile-enabled" size="2">
            Enabled
          </Text>
        </Flex>
      </Flex>
      <Flex gap="3" mt="5" justify="end">
        <Button type="button" variant="soft" color="gray" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting} disabled={submitting || name.trim() === ''}>
          {submitLabel}
        </Button>
      </Flex>
    </form>
  );
}

/**
 * The destructive confirmation for deleting a profile — a controlled
 * `AlertDialog`. On confirm, fires `DELETE /profiles/:id`, surfaces a toast,
 * and lets the parent run the selection-fallback.
 */
function DeleteProfileDialog({
  profile,
  onOpenChange,
  onDeleted,
}: {
  profile: Profile;
  onOpenChange: (open: boolean) => void;
  onDeleted: (profile: Profile) => void | Promise<void>;
}): ReactNode {
  const remove = useDeleteProfile();

  async function handleConfirm(): Promise<void> {
    try {
      await remove.mutateAsync(profile.id);
      toast.success(`Deleted ${profile.name}`);
      await onDeleted(profile);
      onOpenChange(false);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'failed to delete profile';
      log.warn({ err: cause, id: profile.id }, 'delete profile failed');
      toast.error(message);
    }
  }

  return (
    <AlertDialog.Root open={true} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Delete profile</AlertDialog.Title>
        <AlertDialog.Description size="2">
          <Text>Delete profile “{profile.name}”? This can’t be undone.</Text>
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={handleConfirm} loading={remove.isPending}>
              Delete
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
