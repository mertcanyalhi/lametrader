import { type Rule, RuleEventType, RuleScopeKind, TriggerKind } from '@lametrader/core';
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
import { ChevronDown, ChevronUp, ListChecks, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { useDeleteRule, usePatchRule, useReorderRules } from '../../lib/hooks/rules.js';
import { EventsDialog } from './events-dialog.js';

/**
 * The dense rules table — one row per rule, ordered by the server-supplied
 * `order` field. Each row's body click fires {@link onEdit} with the rule so
 * the page can open the editor modal (the modal itself lands with #167).
 *
 * Per-row action buttons (Edit / Events / overflow) keep keyboard + a11y
 * affordances even when the row itself is clickable. The Events / overflow
 * handlers are placeholders until #176 / #164–#166 wire them up.
 *
 * @param rules    - The rules to render, in the order returned by the API.
 * @param onEdit   - Invoked with the rule when its row (or Edit button) is clicked.
 */
export function RulesTable({
  rules,
  onEdit,
}: {
  rules: Rule[];
  onEdit: (rule: Rule) => void;
}): ReactNode {
  const reorder = useReorderRules();
  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const ids = rules.map((rule) => rule.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(target, 0, moved);
    reorder.mutate(ids, {
      onError: (cause) => {
        const message = cause instanceof ApiError ? cause.message : 'Failed to reorder rules';
        toast.error(message);
      },
    });
  }
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
          <Table.ColumnHeaderCell aria-label="Toggle" width="52px" />
          <Table.ColumnHeaderCell aria-label="Reorder" width="76px" />
          <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Scope</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Trigger</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Last fired</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">Actions</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rules.map((rule, index) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            onEdit={onEdit}
            canMoveUp={index > 0}
            canMoveDown={index < rules.length - 1}
            onMoveUp={() => move(index, -1)}
            onMoveDown={() => move(index, 1)}
          />
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function RuleRow({
  rule,
  onEdit,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  rule: Rule;
  onEdit: (rule: Rule) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): ReactNode {
  const rowName = `Open ${rule.name}`;
  const patch = usePatchRule();
  const remove = useDeleteRule();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [viewingEvents, setViewingEvents] = useState(false);
  function toggleEnabled(next: boolean): void {
    patch.mutate(
      { id: rule.id, patch: { enabled: next } },
      {
        onError: (cause) => {
          const message =
            cause instanceof ApiError ? cause.message : `Failed to update ${rule.name}`;
          toast.error(message);
        },
      },
    );
  }
  function confirmDelete(): void {
    remove.mutate(rule.id, {
      onSuccess: () => toast.success(`Deleted ${rule.name}`),
      onError: (cause) => {
        const message = cause instanceof ApiError ? cause.message : `Failed to delete ${rule.name}`;
        toast.error(message);
      },
    });
    setConfirmingDelete(false);
  }
  return (
    <Table.Row className="align-middle">
      <Table.Cell>
        <Tooltip content={rule.enabled ? 'Pause' : 'Resume'}>
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            aria-label={`${rule.enabled ? 'Pause' : 'Resume'} ${rule.name}`}
            onClick={() => toggleEnabled(!rule.enabled)}
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
        <Flex gap="1">
          <Tooltip content="Move up">
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              aria-label={`Move ${rule.name} up`}
              onClick={onMoveUp}
              disabled={!canMoveUp}
            >
              <ChevronUp size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
          <Tooltip content="Move down">
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              aria-label={`Move ${rule.name} down`}
              onClick={onMoveDown}
              disabled={!canMoveDown}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </Flex>
      </Table.Cell>
      <Table.Cell>
        <Flex gap="2" align="center">
          <button
            type="button"
            onClick={() => onEdit(rule)}
            aria-label={rowName}
            className="text-left font-medium text-[var(--gray-12)] hover:underline"
          >
            {rule.name}
          </button>
          <Badge color={rule.enabled ? 'green' : 'red'} variant="soft">
            {rule.enabled ? 'Active' : 'Inactive'}
          </Badge>
        </Flex>
      </Table.Cell>
      <Table.Cell>
        <Text size="2" color="gray">
          {formatScope(rule)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text size="2" color="gray">
          {formatTrigger(rule)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text size="2" color="gray">
          {formatLastFired(rule)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Flex gap="2" justify="end">
          <Tooltip content="Edit">
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              aria-label={`Edit ${rule.name}`}
              onClick={() => onEdit(rule)}
            >
              <Pencil size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
          <Tooltip content="Events">
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              aria-label={`Events for ${rule.name}`}
              onClick={() => setViewingEvents(true)}
            >
              <ListChecks size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
          <Tooltip content="Delete">
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              aria-label={`Delete ${rule.name}`}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </Flex>
      </Table.Cell>
      {viewingEvents ? (
        <EventsDialog
          open={true}
          onOpenChange={setViewingEvents}
          mode={{ kind: 'rule', ruleId: rule.id, ruleName: rule.name }}
        />
      ) : null}
      {confirmingDelete ? (
        <AlertDialog.Root open={true} onOpenChange={setConfirmingDelete}>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Delete rule</AlertDialog.Title>
            <AlertDialog.Description size="2">
              <Text>Delete rule “{rule.name}”? This can’t be undone.</Text>
            </AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button color="red" onClick={confirmDelete}>
                  Delete
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      ) : null}
    </Table.Row>
  );
}

function formatScope(rule: Rule): string {
  if (rule.scope.kind === RuleScopeKind.AllSymbols) return 'All symbols';
  return rule.scope.symbolId;
}

function formatTrigger(rule: Rule): string {
  switch (rule.trigger.kind) {
    case TriggerKind.Once:
      return 'Once';
    case TriggerKind.OncePerBar:
      return `Once per bar (${rule.trigger.period})`;
    case TriggerKind.OncePerBarClose:
      return `Once per bar close (${rule.trigger.period})`;
    case TriggerKind.OncePerMinute: {
      const seconds = Math.round(rule.trigger.intervalMs / 1000);
      return `Once per ${seconds}s`;
    }
  }
}

function formatLastFired(rule: Rule): string {
  let latest = 0;
  for (const event of rule.events) {
    if (event.type === RuleEventType.Fired && event.ts > latest) latest = event.ts;
  }
  if (latest === 0) return 'Never';
  return new Date(latest).toISOString().replace('T', ' ').slice(0, 16);
}
