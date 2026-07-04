import type { Rule } from '@lametrader/core';
import { Button, Callout, Card, Flex, Heading, Skeleton, Text } from '@radix-ui/themes';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { makeDraftRule } from '../../lib/draft-rule.js';
import { useRules } from '../../lib/hooks/rules.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { ProfilePickerDialog } from '../chart/profile-picker-dialog.js';
import { RuleEditorDialog } from './rule-editor-dialog.js';
import { RuleEventsDialog } from './rule-events-dialog.js';
import { RulesTable } from './rules-table.js';

/**
 * The `/rules` route — the only rules editor surface post-cutover.
 *
 * Profile-scoped rule list rendered as a management table (play/pause, Name,
 * Scope, Trigger, Last fired, Actions) per issue #426. The `New rule` button
 * opens the editor dialog; each row's actions open edit / events / delete.
 */
export function RulesPage(): ReactNode {
  const { profileId } = useSelectedProfile();
  const [editing, setEditing] = useState<Rule | null>(null);
  const [eventsRule, setEventsRule] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col gap-3">
      <Card>
        <div className="flex flex-col gap-3 p-2">
          <Flex align="center" justify="between" gap="2">
            <Heading size="5">Rules</Heading>
            <Button onClick={() => setCreating(true)} disabled={profileId === null}>
              <Plus size={16} aria-hidden="true" />
              New rule
            </Button>
          </Flex>
          {profileId === null ? (
            <Text size="2" color="gray">
              Pick a profile from the bottom bar to see its rules.
            </Text>
          ) : (
            <RulesContent profileId={profileId} onEdit={setEditing} onEvents={setEventsRule} />
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
      {creating && profileId !== null ? (
        <RuleEditorDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) setCreating(false);
          }}
          mode="create"
          initial={makeDraftRule({ profileId })}
        />
      ) : null}
      {editing ? (
        <RuleEditorDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          mode="edit"
          initial={editing}
        />
      ) : null}
      {eventsRule ? (
        <RuleEventsDialog
          rule={eventsRule}
          open={true}
          onOpenChange={(next) => {
            if (!next) setEventsRule(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Profile-scoped rules-list body. Mounted only when a profile is selected, so
 * {@link useRules} is fetched per-profile and re-runs cleanly on a profile
 * switch.
 */
function RulesContent({
  profileId,
  onEdit,
  onEvents,
}: {
  profileId: string;
  onEdit: (rule: Rule) => void;
  onEvents: (rule: Rule) => void;
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
  if (query.data.length === 0) {
    return (
      <Text size="2" color="gray">
        No rules in this profile yet.
      </Text>
    );
  }
  return <RulesTable rules={query.data} onEdit={onEdit} onEvents={onEvents} />;
}
