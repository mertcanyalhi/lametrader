import { type Rule, RuleEventType, RuleScopeKind, TriggerKind } from '@lametrader/core';
import { Flex, IconButton, Table, Text, Tooltip } from '@radix-ui/themes';
import { ListChecks, MoreHorizontal, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

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
          <Table.ColumnHeaderCell>Order</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Scope</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Trigger</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Last fired</Table.ColumnHeaderCell>
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

function RuleRow({ rule, onEdit }: { rule: Rule; onEdit: (rule: Rule) => void }): ReactNode {
  const rowName = `Open ${rule.name}`;
  return (
    <Table.Row className="align-middle">
      <Table.Cell>{rule.order}</Table.Cell>
      <Table.Cell>
        <button
          type="button"
          onClick={() => onEdit(rule)}
          aria-label={rowName}
          className="text-left font-medium text-[var(--gray-12)] hover:underline"
        >
          {rule.name}
        </button>
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
              disabled
            >
              <ListChecks size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
          <Tooltip content="More">
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              aria-label={`More actions for ${rule.name}`}
              disabled
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </Flex>
      </Table.Cell>
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
