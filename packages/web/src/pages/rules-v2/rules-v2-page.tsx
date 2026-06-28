import { RulesV2, StateValueType } from '@lametrader/core';
import { Button, Callout, Card, Flex, Heading, Skeleton, Text } from '@radix-ui/themes';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useRulesV2 } from '../../lib/hooks/rules-v2.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { ProfilePickerDialog } from '../chart/profile-picker-dialog.js';
import { RuleV2EditorDialog } from './rule-v2-editor-dialog.js';
import { RulesV2Table } from './rules-v2-table.js';

/**
 * The `/rules` route — the v2 rule editor (per #396, replaces the v1 page).
 *
 * Wires the bottom-bar profile picker (mirroring the chart page) and renders
 * the v2 rules list once a profile is selected, plus a `New rule` button that
 * opens an empty editor dialog and a row-edit click that opens it pre-filled.
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
      {creating && profileId !== null ? (
        <RuleV2EditorDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) setCreating(false);
          }}
          mode="create"
          initial={emptyDraftRuleV2(profileId)}
        />
      ) : null}
      {editing ? (
        <RuleV2EditorDialog
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
 * Profile-scoped rules-list body. Mounted only when a profile is selected, so
 * the query refetches cleanly on a profile switch.
 */
function RulesContent({
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
  return <RulesV2Table rules={query.data} onEdit={onEdit} />;
}

/**
 * Build a neutral draft v2 rule for the "New rule" dialog — `Price > 0` on
 * one symbol (left blank), `EveryTime` trigger, one Telegram notification
 * action, no expiration.
 */
function emptyDraftRuleV2(profileId: string): RulesV2.Rule {
  return {
    id: '',
    profileId,
    name: '',
    description: '',
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: '' },
    condition: {
      kind: RulesV2.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2.LeafConditionFamily.Comparison,
        operator: RulesV2.ComparisonOperator.Gt,
        left: { kind: RulesV2.OperandKind.Price },
        right: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Number, value: 0 },
        },
      },
    },
    trigger: { kind: RulesV2.TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: '',
        template: '',
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}
