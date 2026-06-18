import { yupResolver } from '@hookform/resolvers/yup';
import type { Profile } from '@lametrader/core';
import { Button, Dialog, Flex, Switch, Text, TextArea, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { Controller, type SubmitHandler, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { useCreateProfile, useUpdateProfile } from '../../lib/hooks/profiles.js';
import { getLogger } from '../../lib/log.js';
import {
  PROFILE_FIELD_LABELS,
  type ProfileFormValues,
  profileSchema,
} from '../../lib/profile-schema.js';
import { useSelectedProfile } from '../../lib/selected-profile/selected-profile-context.js';

/** Scoped logger for the profile create/edit flow. */
const log = getLogger('profile-form-dialog');

/**
 * The create/edit profile dialog. With no `profile` it creates (`POST`); with a
 * `profile` it edits (`PATCH`, preserving scope + indicators). On a successful
 * create the new profile becomes the selection. A duplicate name (`409`) renders
 * inline under the name field; the form keeps `name` / `description` / `enabled`
 * only.
 *
 * @param open - controlled open state.
 * @param onOpenChange - controlled open-state setter.
 * @param profile - the profile to edit; omitted for create.
 */
export function ProfileFormDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile?: Profile;
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="460px">
        {open ? <ProfileForm profile={profile} onClose={() => onOpenChange(false)} /> : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * The form body, mounted fresh each time the dialog opens so react-hook-form's
 * `defaultValues` hydrate from the current `profile` (mirrors the settings form).
 */
function ProfileForm({ profile, onClose }: { profile?: Profile; onClose: () => void }): ReactNode {
  const isEdit = profile !== undefined;
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const { setProfileId } = useSelectedProfile();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: yupResolver(profileSchema),
    defaultValues: {
      name: profile?.name ?? '',
      description: profile?.description ?? '',
      enabled: profile?.enabled ?? true,
    },
  });
  const pending = create.isPending || update.isPending;

  const onSubmit: SubmitHandler<ProfileFormValues> = async (values) => {
    try {
      if (profile) {
        await update.mutateAsync({ id: profile.id, input: values });
        toast.success(`Updated ${values.name}`);
      } else {
        const created = await create.mutateAsync(values);
        setProfileId(created.id);
        toast.success(`Created ${created.name}`);
      }
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError('name', { message: cause.message });
        return;
      }
      const message = cause instanceof ApiError ? cause.message : 'failed to save profile';
      log.warn({ err: cause }, 'save profile failed');
      toast.error(message);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Dialog.Title>{isEdit ? 'Edit profile' : 'New profile'}</Dialog.Title>
      <Dialog.Description size="2" color="gray">
        {isEdit ? 'Update the profile details.' : 'Create a profile to drive chart overlays.'}
      </Dialog.Description>

      <Flex direction="column" gap="3" mt="4">
        <div className="flex flex-col gap-1">
          <label htmlFor="profile-name" className="text-sm font-medium">
            {PROFILE_FIELD_LABELS.name}
          </label>
          <TextField.Root
            id="profile-name"
            placeholder="Profile name"
            aria-label={PROFILE_FIELD_LABELS.name}
            aria-invalid={errors.name ? true : undefined}
            {...register('name')}
          />
          {errors.name ? (
            <Text role="alert" color="red" size="1">
              {errors.name.message}
            </Text>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="profile-description" className="text-sm font-medium">
            {PROFILE_FIELD_LABELS.description}
          </label>
          <TextArea
            id="profile-description"
            placeholder="Optional description"
            aria-label={PROFILE_FIELD_LABELS.description}
            {...register('description')}
          />
        </div>

        <Controller
          control={control}
          name="enabled"
          render={({ field }) => (
            <Text as="label" size="2" className="flex items-center gap-2">
              <Switch checked={field.value} onCheckedChange={field.onChange} />
              {PROFILE_FIELD_LABELS.enabled}
            </Text>
          )}
        />
      </Flex>

      <Flex gap="3" mt="4" justify="end">
        <Dialog.Close>
          <Button type="button" variant="soft" color="gray">
            Cancel
          </Button>
        </Dialog.Close>
        <Button type="submit" disabled={pending} loading={pending}>
          {isEdit ? 'Save' : 'Create'}
        </Button>
      </Flex>
    </form>
  );
}
