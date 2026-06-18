import { Select, Text } from '@radix-ui/themes';
import { type ReactNode, useEffect } from 'react';
import { useProfiles } from '../../lib/hooks/profiles.js';
import { resolveSelectedProfileId } from '../../lib/selected-profile/resolve-selected-profile.js';
import { useSelectedProfile } from '../../lib/selected-profile/selected-profile-context.js';

/**
 * The global profile selector that lives in the bottom status bar: it lists the
 * server's profiles, shows the active one on its trigger, and writes the choice
 * to the shared {@link useSelectedProfile} store (persisted to `localStorage`).
 *
 * Once the profiles load it reconciles the stored selection against them — the
 * first-run default (first enabled profile) and the recovery when a stored
 * profile no longer exists both flow through {@link resolveSelectedProfileId}.
 * The reconciliation is gated on the query having resolved so a pending fetch
 * never clobbers a valid stored selection.
 *
 * Create / edit / delete management ("Manage profiles…") arrives in a later
 * iteration; this is the selection surface only.
 */
export function ProfileSelector(): ReactNode {
  const { data } = useProfiles();
  const { profileId, setProfileId } = useSelectedProfile();
  const profiles = data ?? [];

  useEffect(() => {
    if (data === undefined) return;
    const resolved = resolveSelectedProfileId(data, profileId);
    if (resolved !== profileId) setProfileId(resolved);
  }, [data, profileId, setProfileId]);

  return (
    <Select.Root
      value={profileId ?? undefined}
      disabled={profiles.length === 0}
      onValueChange={setProfileId}
    >
      <Select.Trigger aria-label="Selected profile" placeholder="No profile" className="min-w-40" />
      <Select.Content>
        {profiles.map((profile) => (
          <Select.Item key={profile.id} value={profile.id}>
            {profile.name}
            {profile.enabled ? null : (
              <Text color="gray" size="1">
                {' '}
                (disabled)
              </Text>
            )}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
