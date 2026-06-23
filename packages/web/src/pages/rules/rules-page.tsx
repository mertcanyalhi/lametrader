import type { Rule } from '@lametrader/core';
import { Callout, Card, Flex, Heading, Skeleton, Text } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import { useRules } from '../../lib/hooks/rules.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { ProfilePickerDialog } from '../chart/profile-picker-dialog.js';
import { RulesTable } from './rules-table.js';

/**
 * The `/rules` route component.
 *
 * Wires the bottom-bar profile picker (mirroring the chart page) and
 * delegates rendering of the rule list to {@link RulesContent}, which is
 * only mounted once a profile is selected — keeps the `useRules` query
 * cleanly conditional on the selection without an `enabled` flag.
 *
 * Row-click captures the `editing` rule here; the editor modal that
 * consumes that state lands with #167.
 */
export function RulesPage(): ReactNode {
  const { profileId } = useSelectedProfile();
  // Editor modal lands in #167; we already capture the selection so the
  // table's row-click wire-up doesn't need to change when the modal arrives.
  const [, setEditing] = useState<Rule | null>(null);

  return (
    <div className="flex h-full flex-col gap-3">
      <Card>
        <div className="flex flex-col gap-3 p-2">
          <Heading size="5">Rules</Heading>
          {profileId === null ? (
            <Text size="2" color="gray">
              Pick a profile from the bottom bar to see its rules.
            </Text>
          ) : (
            <RulesContent profileId={profileId} onEdit={setEditing} />
          )}
        </div>
      </Card>
      <div className="flex-1" aria-hidden="true" />
      <Flex
        gap="2"
        align="center"
        className="border-t border-[var(--gray-a5)] pt-3"
        role="group"
        aria-label="Rules page actions"
      >
        <ProfilePickerDialog />
      </Flex>
    </div>
  );
}

/**
 * Profile-scoped rules-list body. Mounted only when a profile is selected,
 * so {@link useRules} is fetched per-profile and re-runs cleanly on a
 * profile switch (the unique cache key plus the parent's conditional
 * mount handle invalidation).
 */
function RulesContent({
  profileId,
  onEdit,
}: {
  profileId: string;
  onEdit: (rule: Rule) => void;
}): ReactNode {
  const query = useRules({ profileId });
  if (query.isPending) return <Skeleton height="1.25rem" width="10rem" />;
  if (query.isError) {
    return (
      <Callout.Root color="red" role="alert">
        <Callout.Text>{query.error.message}</Callout.Text>
      </Callout.Root>
    );
  }
  return <RulesTable rules={query.data} onEdit={onEdit} />;
}
