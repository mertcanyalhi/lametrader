import type { Rule } from '@lametrader/core';
import { Button, Callout, Dialog, Flex, Skeleton, Text } from '@radix-ui/themes';
import { Plus, Scale } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { makeDraftRule } from '../../lib/draft-rule.js';
import { useRules } from '../../lib/hooks/rules.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { RuleEditorDialog } from '../rules/rule-editor-dialog.js';
import { RulesTable } from '../rules/rules-table.js';

/**
 * The chart bottom-bar Rules item — a button labelled `Rules N` (N is the
 * count of rules in the current profile scoped to the current symbol). The
 * count is live: the query refetches when the profile or symbol id changes
 * because both flow into its cache key.
 *
 * Clicking opens a {@link Dialog} containing the same {@link RulesTable}
 * the `/rules` page uses, filtered to the symbol. The dialog has a
 * `+ New rule` affordance that opens the editor in create mode with the
 * profile + symbol pre-filled.
 *
 * @param symbolId - the chart's current symbol id.
 */
export function ChartRulesButton({ symbolId }: { symbolId: string }): ReactNode {
  const { profileId } = useSelectedProfile();
  const rulesQuery = useRules(profileId === null ? {} : { profileId, symbolId });
  const rules = rulesQuery.data ?? [];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);

  const triggerLabel = profileId === null ? 'Rules' : `Rules ${rules.length}`;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger>
          <Button
            variant="soft"
            color="gray"
            className="min-w-32 justify-center"
            disabled={profileId === null}
          >
            <Scale size={14} aria-hidden="true" />
            {triggerLabel}
          </Button>
        </Dialog.Trigger>
        <Dialog.Content maxWidth="720px">
          <Dialog.Title>Rules for {symbolId}</Dialog.Title>
          {profileId === null ? (
            <Text size="2" color="gray">
              Pick a profile from the bottom bar to see its rules.
            </Text>
          ) : rulesQuery.isPending ? (
            <Skeleton height="3rem" />
          ) : rulesQuery.isError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{rulesQuery.error.message}</Callout.Text>
            </Callout.Root>
          ) : (
            <RulesTable rules={rules} onEdit={setEditing} />
          )}
          <Flex gap="3" mt="4" justify="between" align="center">
            {profileId !== null ? (
              <Button type="button" variant="soft" onClick={() => setCreating(true)}>
                <Plus size={14} aria-hidden="true" />
                New rule
              </Button>
            ) : (
              <span />
            )}
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
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
      {creating && profileId !== null ? (
        <RuleEditorDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) setCreating(false);
          }}
          mode="create"
          initial={makeDraftRule({ profileId, symbolId })}
        />
      ) : null}
    </>
  );
}
