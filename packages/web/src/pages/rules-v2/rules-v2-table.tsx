import { RulesV2 } from '@lametrader/core';
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  Table,
  Text,
  Tooltip,
} from '@radix-ui/themes';
import { Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { useDeleteRuleV2, useReplaceRuleV2 } from '../../lib/hooks/rules-v2.js';

/**
 * The v2 rules table — one row per rule, ordered by the server-supplied
 * `order` field. Each row exposes an enable/disable toggle (PATCH), edit
 * (open the editor dialog), and delete (with confirm).
 */
export function RulesV2Table({
  rules,
  onEdit,
}: {
  rules: RulesV2.Rule[];
  onEdit: (rule: RulesV2.Rule) => void;
}): ReactNode {
  if (rules.length === 0) {
    return (
      <Text size="2" color="gray" role="status">
        No rules in this profile yet.
      </Text>
    );
  }
  return (
    <Table.Root variant="surface" size="1">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell aria-label="Toggle" width="26px" />
          <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Scope</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Trigger</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">Actions</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} onEdit={onEdit} />
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function RuleRow({
  rule,
  onEdit,
}: {
  rule: RulesV2.Rule;
  onEdit: (rule: RulesV2.Rule) => void;
}): ReactNode {
  const replace = useReplaceRuleV2();
  const del = useDeleteRuleV2();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  function toggle(): void {
    replace.mutate(
      { id: rule.id, patch: { enabled: !rule.enabled } },
      {
        onError: (cause) => {
          toast.error(cause instanceof ApiError ? cause.message : `Failed to toggle ${rule.name}`);
        },
      },
    );
  }
  function remove(): void {
    del.mutate(rule.id, {
      onSuccess: () => {
        toast.success(`Deleted ${rule.name}`);
        setConfirmingDelete(false);
      },
      onError: (cause) => {
        toast.error(cause instanceof ApiError ? cause.message : `Failed to delete ${rule.name}`);
      },
    });
  }
  const scopeLabel = scopeLabelFor(rule.scope);
  const triggerLabel = triggerLabelFor(rule.trigger);
  return (
    <Table.Row>
      <Table.Cell>
        <Tooltip content={rule.enabled ? 'Disable' : 'Enable'}>
          <IconButton
            type="button"
            size="1"
            variant="ghost"
            color={rule.enabled ? 'green' : 'gray'}
            aria-label={rule.enabled ? `Disable ${rule.name}` : `Enable ${rule.name}`}
            onClick={toggle}
          >
            {rule.enabled ? (
              <Pause size={14} aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )}
          </IconButton>
        </Tooltip>
      </Table.Cell>
      <Table.Cell>
        <Flex direction="column">
          <Text size="2" weight="medium">
            {rule.name}
          </Text>
          {!rule.enabled ? (
            <Badge color="gray" size="1" variant="soft">
              Disabled
            </Badge>
          ) : null}
        </Flex>
      </Table.Cell>
      <Table.Cell>{scopeLabel}</Table.Cell>
      <Table.Cell>{triggerLabel}</Table.Cell>
      <Table.Cell justify="end">
        <Flex gap="2" justify="end">
          <Tooltip content="Edit">
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              size="1"
              aria-label={`Edit ${rule.name}`}
              onClick={() => onEdit(rule)}
            >
              <Pencil size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
          <AlertDialog.Root
            open={confirmingDelete}
            onOpenChange={(next) => setConfirmingDelete(next)}
          >
            <Tooltip content="Delete">
              <AlertDialog.Trigger>
                <IconButton
                  type="button"
                  variant="ghost"
                  color="red"
                  size="1"
                  aria-label={`Delete ${rule.name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </IconButton>
              </AlertDialog.Trigger>
            </Tooltip>
            <AlertDialog.Content maxWidth="420px">
              <AlertDialog.Title>Delete rule</AlertDialog.Title>
              <AlertDialog.Description size="2">
                Delete “{rule.name}”? This can't be undone.
              </AlertDialog.Description>
              <Flex gap="3" mt="4" justify="end">
                <AlertDialog.Cancel>
                  <Button variant="soft" color="gray">
                    Cancel
                  </Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action>
                  <Button color="red" onClick={remove}>
                    Delete
                  </Button>
                </AlertDialog.Action>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </Flex>
      </Table.Cell>
    </Table.Row>
  );
}

function scopeLabelFor(scope: RulesV2.RuleScope): string {
  switch (scope.kind) {
    case RulesV2.RuleScopeKind.Symbol:
      return scope.symbolId;
    case RulesV2.RuleScopeKind.Symbols:
      return scope.symbolIds.join(', ');
    case RulesV2.RuleScopeKind.AllSymbols:
      return 'All symbols';
  }
}

function triggerLabelFor(trigger: RulesV2.Trigger): string {
  switch (trigger.kind) {
    case RulesV2.TriggerKind.EveryTime:
      return 'Every time';
    case RulesV2.TriggerKind.Once:
      return 'Once';
    case RulesV2.TriggerKind.OncePerBar:
      return `Once per bar (${trigger.period})`;
    case RulesV2.TriggerKind.OncePerBarOpen:
      return `Once per bar open (${trigger.period})`;
    case RulesV2.TriggerKind.OncePerBarClose:
      return `Once per bar close (${trigger.period})`;
    case RulesV2.TriggerKind.OncePerInterval:
      return `Once per ${trigger.intervalMs}ms`;
  }
}
