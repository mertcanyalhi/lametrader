import {
  type Period,
  type Rule,
  type RuleScope,
  RuleScopeKind,
  type Trigger,
  TriggerKind,
} from '@lametrader/core';
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  Switch,
  Table,
  Text,
  Tooltip,
} from '@radix-ui/themes';
import { Activity, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api-fetch.js';
import { formatTimestamp } from '../../lib/format.js';
import { useDeleteRule, usePatchRule } from '../../lib/hooks/rules.js';
import { PERIOD_LABELS, TRIGGER_KIND_LABELS } from './trigger-picker.js';

/**
 * Per-column visibility toggles for {@link RulesTable}.
 *
 * The default config (everything `true`) drives the global `/rules` page; the
 * Charts-page symbol-scoped modal (#427) hides `scope` since every row is
 * implicitly scoped to the chart's symbol.
 */
export interface RulesTableColumns {
  /** The leading play/pause toggle cell. Default `true`. */
  enabled?: boolean;
  /** The rule name + Active/Inactive badge cell. Default `true`. */
  name?: boolean;
  /** The Scope cell ("Single <symbol>" / "Multiple <count>" / "All"). Default `true`. */
  scope?: boolean;
  /** The Trigger cell (kind + period / intervalMs). Default `true`. */
  trigger?: boolean;
  /** The Last fired cell (formatted timestamp or "Never"). Default `true`. */
  lastFired?: boolean;
  /** The trailing Actions cell (Edit / Events / Delete). Default `true`. */
  actions?: boolean;
}

/**
 * Whether `columns` says the given column is visible.
 *
 * Defaults every column to visible — callers opt out by setting a column to
 * `false`.
 */
function isVisible(
  columns: RulesTableColumns | undefined,
  column: keyof RulesTableColumns,
): boolean {
  if (columns === undefined) return true;
  return columns[column] !== false;
}

/**
 * The shared management table for v2 rules.
 *
 * Renders one row per rule with six columns:
 *
 * 1. play/pause toggle — flips `enabled` via {@link usePatchRule}.
 * 2. Name + colored Active/Inactive badge.
 * 3. Scope — `Single <symbol>` / `Multiple <count>` / `All` per #426.
 * 4. Trigger — kind label plus per-kind disambiguator (`(1m)`, `(60000ms)`, …).
 * 5. Last fired — formatted timestamp or `Never`.
 * 6. Actions — Edit / Events / Delete icon buttons.
 *
 * The `columns` prop omits per-column cells (Charts-page reuse in #427 hides
 * Scope since every row is implicitly scoped to the chart's symbol).
 */
export function RulesTable({
  rules,
  columns,
  onEdit,
  onEvents,
}: {
  /** The rules to render — already filtered/sorted by the caller. */
  rules: Rule[];
  /** Per-column visibility config. Default: every column visible. */
  columns?: RulesTableColumns;
  /** Invoked when the user clicks the row's Edit action. */
  onEdit: (rule: Rule) => void;
  /** Invoked when the user clicks the row's Events action. */
  onEvents: (rule: Rule) => void;
}): ReactNode {
  return (
    <Table.Root variant="surface" size="1">
      <Table.Header>
        <Table.Row>
          {isVisible(columns, 'enabled') ? <Table.ColumnHeaderCell aria-label="Enabled" /> : null}
          {isVisible(columns, 'name') ? (
            <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
          ) : null}
          {isVisible(columns, 'scope') ? (
            <Table.ColumnHeaderCell>Scope</Table.ColumnHeaderCell>
          ) : null}
          {isVisible(columns, 'trigger') ? (
            <Table.ColumnHeaderCell>Trigger</Table.ColumnHeaderCell>
          ) : null}
          {isVisible(columns, 'lastFired') ? (
            <Table.ColumnHeaderCell>Last fired</Table.ColumnHeaderCell>
          ) : null}
          {isVisible(columns, 'actions') ? (
            <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
          ) : null}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            columns={columns}
            onEdit={onEdit}
            onEvents={onEvents}
          />
        ))}
      </Table.Body>
    </Table.Root>
  );
}

/**
 * One rendered rule row.
 *
 * Extracted from {@link RulesTable} so each row can own its own delete-confirm
 * state without prop-drilling per-row callbacks through the table shell.
 */
function RuleRow({
  rule,
  columns,
  onEdit,
  onEvents,
}: {
  rule: Rule;
  columns?: RulesTableColumns;
  onEdit: (rule: Rule) => void;
  onEvents: (rule: Rule) => void;
}): ReactNode {
  const patch = usePatchRule();
  return (
    <Table.Row align="center">
      {isVisible(columns, 'enabled') ? (
        <Table.Cell>
          <Switch
            checked={rule.enabled}
            disabled={patch.isPending}
            onCheckedChange={(next) =>
              patch.mutate({ id: rule.id, patch: { enabled: next === true } })
            }
            aria-label={rule.enabled ? `Disable ${rule.name}` : `Enable ${rule.name}`}
          />
        </Table.Cell>
      ) : null}
      {isVisible(columns, 'name') ? (
        <Table.Cell>
          <Flex direction="column" gap="1">
            <Flex gap="2" align="center">
              <Text weight="bold">{rule.name}</Text>
              <Badge color={rule.enabled ? 'green' : 'gray'}>
                {rule.enabled ? 'Active' : 'Inactive'}
              </Badge>
            </Flex>
            {rule.description !== undefined && rule.description !== '' ? (
              <Text size="1" color="gray">
                {rule.description}
              </Text>
            ) : null}
          </Flex>
        </Table.Cell>
      ) : null}
      {isVisible(columns, 'scope') ? (
        <Table.Cell>
          <ScopeCell scope={rule.scope} />
        </Table.Cell>
      ) : null}
      {isVisible(columns, 'trigger') ? (
        <Table.Cell>
          <Text size="2">{formatTrigger(rule.trigger)}</Text>
        </Table.Cell>
      ) : null}
      {isVisible(columns, 'lastFired') ? (
        <Table.Cell>
          <Text size="2" color={rule.lastFiredAt === undefined ? 'gray' : undefined}>
            {rule.lastFiredAt === undefined ? 'Never' : formatTimestamp(rule.lastFiredAt)}
          </Text>
        </Table.Cell>
      ) : null}
      {isVisible(columns, 'actions') ? (
        <Table.Cell>
          <Flex gap="1" align="center">
            <Tooltip content="Edit rule">
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
            <Tooltip content="View events">
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                aria-label={`Events for ${rule.name}`}
                onClick={() => onEvents(rule)}
              >
                <Activity size={14} aria-hidden="true" />
              </IconButton>
            </Tooltip>
            <DeleteRuleAction rule={rule} />
          </Flex>
        </Table.Cell>
      ) : null}
    </Table.Row>
  );
}

/**
 * The Scope cell content — `Single <symbol>` / `Multiple <count>` / `All` per
 * issue #426's settled decision. The symbol id / count are emphasised so the
 * variable part reads at a glance.
 */
function ScopeCell({ scope }: { scope: RuleScope }): ReactNode {
  switch (scope.kind) {
    case RuleScopeKind.Symbol:
      return (
        <Text size="2">
          Single <Text weight="medium">{scope.symbolId}</Text>
        </Text>
      );
    case RuleScopeKind.Symbols:
      return (
        <Text size="2">
          Multiple <Text weight="medium">{scope.symbolIds.length}</Text>
        </Text>
      );
    case RuleScopeKind.AllSymbols:
      return <Text size="2">All</Text>;
  }
}

/**
 * Format a {@link Trigger} as one human-readable line — the kind's label, plus
 * a parenthesised disambiguator when the trigger needs one
 * (bar-cadence period or wall-clock intervalMs).
 *
 * `EveryTime` / `Once` carry no disambiguator and render as the bare label.
 */
export function formatTrigger(trigger: Trigger): string {
  const label = TRIGGER_KIND_LABELS[trigger.kind];
  if (
    trigger.kind === TriggerKind.OncePerBar ||
    trigger.kind === TriggerKind.OncePerBarOpen ||
    trigger.kind === TriggerKind.OncePerBarClose
  ) {
    return `${label} (${shortPeriod(trigger.period)})`;
  }
  if (trigger.kind === TriggerKind.OncePerInterval) {
    return `${label} (${trigger.intervalMs}ms)`;
  }
  return label;
}

/**
 * Compact period label for the trigger column — short over the long
 * picker copy so each row stays on one line.
 *
 * The {@link Period} enum's string value is already a compact token
 * (`'1m'`, `'1h'`, …), so we surface it directly.
 */
function shortPeriod(period: Period): string {
  return period;
}

/**
 * The Delete action with an `AlertDialog` confirm.
 *
 * Lives inside the row so each row owns its own dialog state; the parent table
 * doesn't need a per-row state map.
 */
function DeleteRuleAction({ rule }: { rule: Rule }): ReactNode {
  const del = useDeleteRule();
  return (
    <AlertDialog.Root>
      <Tooltip content="Delete rule">
        <AlertDialog.Trigger>
          <IconButton
            type="button"
            variant="ghost"
            color="red"
            aria-label={`Delete ${rule.name}`}
            disabled={del.isPending}
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
            <Button
              color="red"
              onClick={() =>
                del.mutate(rule.id, {
                  onSuccess: () => toast.success(`Deleted ${rule.name}`),
                  onError: (cause) => {
                    const message =
                      cause instanceof ApiError ? cause.message : `Failed to delete ${rule.name}`;
                    toast.error(message);
                  },
                })
              }
            >
              Delete
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

// Re-exports kept tree-shake-friendly; PERIOD_LABELS is consumed only when a
// future column needs the long-form period name.
export { PERIOD_LABELS };
