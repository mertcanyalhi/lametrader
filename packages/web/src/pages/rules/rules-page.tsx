import { Callout, Card, Flex, Heading, Skeleton, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useRules } from '../../lib/hooks/rules.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { ProfilePickerDialog } from '../chart/profile-picker-dialog.js';

/**
 * The `/rules` route component.
 *
 * Wires the bottom-bar profile picker (mirroring the chart page) and
 * delegates rendering of the rule list to {@link RulesContent}, which is
 * only mounted once a profile is selected — keeps the `useRules` query
 * cleanly conditional on the selection without an `enabled` flag.
 *
 * The list table, editor modal, and events modal land in later
 * sub-issues (#163–#176); for now the body renders a count + a
 * "no profile" empty state so the wiring can be reviewed.
 */
export function RulesPage(): ReactNode {
  const { profileId } = useSelectedProfile();

  return (
    <Flex direction="column" gap="3">
      <Card>
        <div className="flex flex-col gap-3 p-2">
          <Heading size="5">Rules</Heading>
          {profileId === null ? (
            <Text size="2" color="gray">
              Pick a profile from the bottom bar to see its rules.
            </Text>
          ) : (
            <RulesContent profileId={profileId} />
          )}
        </div>
      </Card>
      <Flex
        gap="2"
        align="center"
        className="border-t border-[var(--gray-a5)] pt-3"
        role="group"
        aria-label="Rules page actions"
      >
        <ProfilePickerDialog />
      </Flex>
    </Flex>
  );
}

/**
 * Profile-scoped rules-list body. Mounted only when a profile is selected,
 * so {@link useRules} is fetched per-profile and re-runs cleanly on a
 * profile switch (the unique cache key plus the parent's conditional
 * mount handle invalidation).
 */
function RulesContent({ profileId }: { profileId: string }): ReactNode {
  const query = useRules({ profileId });
  if (query.isPending) return <Skeleton height="1.25rem" width="10rem" />;
  if (query.isError) {
    return (
      <Callout.Root color="red" role="alert">
        <Callout.Text>{query.error.message}</Callout.Text>
      </Callout.Root>
    );
  }
  return (
    <Text size="2" color="gray">
      {query.data.length === 0
        ? 'No rules in this profile yet.'
        : `${query.data.length} ${query.data.length === 1 ? 'rule' : 'rules'} in this profile.`}
    </Text>
  );
}
