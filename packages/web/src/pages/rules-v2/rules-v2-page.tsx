import type { RulesV2 } from '@lametrader/core';
import { Badge, Button, Callout, Card, Flex, Heading, Skeleton, Text } from '@radix-ui/themes';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { makeDraftRuleV2 } from '../../lib/draft-rule-v2.js';
import { useRulesV2 } from '../../lib/hooks/rules-v2.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { ProfilePickerDialog } from '../chart/profile-picker-dialog.js';
import { RuleEditorDialogV2 } from './rule-editor-dialog-v2.js';

/**
 * The `/rules-v2` route — only mounted when the rules-v2 feature flag is on.
 *
 * Mirrors the v1 `RulesPage` shape: a profile-scoped rule list with a
 * `New rule` button that opens the v2 editor dialog. The flag default-off
 * AC is enforced one layer up in `<App>` (the route isn't even mounted when
 * the flag is off).
 */
export function RulesV2Page(): ReactNode {
  const { profileId } = useSelectedProfile();
  const [editing, setEditing] = useState<RulesV2.Rule | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col gap-3">
      <Card>
        <div className="flex flex-col gap-3 p-2">
          <Flex align="center" justify="between" gap="2">
            <Flex gap="2" align="center">
              <Heading size="5">Rules</Heading>
              <Badge color="purple" variant="soft">
                v2 preview
              </Badge>
            </Flex>
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
            <RulesV2Content profileId={profileId} onEdit={setEditing} />
          )}
        </div>
      </Card>
      <div className="flex-1" aria-hidden="true" />
      <Flex
        gap="2"
        align="center"
        className="border-t border-[var(--gray-a5)] pt-3"
        role="group"
        aria-label="Rules v2 page actions"
      >
        <ProfilePickerDialog />
      </Flex>
      {creating && profileId !== null ? (
        <RuleEditorDialogV2
          open={true}
          onOpenChange={(next) => {
            if (!next) setCreating(false);
          }}
          mode="create"
          initial={makeDraftRuleV2({ profileId })}
        />
      ) : null}
      {editing ? (
        <RuleEditorDialogV2
          open={true}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          mode="edit"
          initial={editing}
        />
      ) : null}
    </div>
  );
}

/**
 * Profile-scoped rules-list body for the v2 page. Mounted only when a profile
 * is selected, so {@link useRulesV2} is fetched per-profile and re-runs
 * cleanly on a profile switch.
 */
function RulesV2Content({
  profileId,
  onEdit,
}: {
  profileId: string;
  onEdit: (rule: RulesV2.Rule) => void;
}): ReactNode {
  const query = useRulesV2({ profileId });
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
        No rules yet — create one to start firing notifications and state mutations.
      </Text>
    );
  }
  return (
    <Flex direction="column" gap="2">
      {query.data.map((rule) => (
        <Card
          key={rule.id}
          variant="surface"
          role="button"
          tabIndex={0}
          onClick={() => onEdit(rule)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onEdit(rule);
          }}
        >
          <Flex align="center" justify="between">
            <Flex direction="column" gap="1">
              <Text weight="bold">{rule.name}</Text>
              <Text size="1" color="gray">
                {rule.description ?? ''}
              </Text>
            </Flex>
            <Badge color={rule.enabled ? 'green' : 'gray'}>
              {rule.enabled ? 'enabled' : 'disabled'}
            </Badge>
          </Flex>
        </Card>
      ))}
    </Flex>
  );
}
