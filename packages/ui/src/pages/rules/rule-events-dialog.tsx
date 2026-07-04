import { type Rule, type RuleEventEntry, RuleEventType } from '@lametrader/core';
import { Badge, Button, Callout, Dialog, Flex, Skeleton, Table, Text } from '@radix-ui/themes';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { formatTimestamp } from '../../lib/format.js';
import { useRuleEvents } from '../../lib/hooks/rules.js';

/** Rows shown per page in the events table. */
const PAGE_SIZE = 10;

/** The sortable columns of the events table. */
type SortColumn = 'type' | 'ts';

/** A column + direction the events table is sorted by. */
interface Sort {
  column: SortColumn;
  dir: 'asc' | 'desc';
}

/**
 * Per-event color so the "type" badge reads at a glance even in a dense log.
 *
 * Defaults to gray for anything new on top of the {@link RuleEventType} enum.
 */
const EVENT_COLORS: Readonly<Record<RuleEventType, 'green' | 'amber' | 'blue' | 'red' | 'gray'>> = {
  [RuleEventType.Fired]: 'green',
  [RuleEventType.NotificationSent]: 'blue',
  [RuleEventType.StateSet]: 'blue',
  [RuleEventType.StateRemoved]: 'amber',
  [RuleEventType.Error]: 'red',
  [RuleEventType.CycleOverflow]: 'red',
};

/**
 * The rule-events view — newest-first table of one rule's event log.
 *
 * Opened from the rules table's Events action; fetches via {@link useRuleEvents}
 * (the 50 most recent entries) and renders them sortable + paginated.
 */
export function RuleEventsDialog({
  rule,
  open,
  onOpenChange,
}: {
  /** The rule whose events to show; `null` keeps the dialog closed. */
  rule: Rule;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}): ReactNode {
  const query = useRuleEvents(rule.id);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="720px" aria-describedby={undefined}>
        <Dialog.Title>
          Events —{' '}
          <Text as="span" size="4" weight="regular" color="gray">
            {rule.name}
          </Text>
        </Dialog.Title>
        <Flex direction="column" gap="2" mt="3">
          {query.isPending ? (
            <Skeleton height="6rem" />
          ) : query.isError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{query.error.message}</Callout.Text>
            </Callout.Root>
          ) : query.data.length === 0 ? (
            <Text size="2" color="gray">
              No events yet — the rule hasn't fired.
            </Text>
          ) : (
            <RuleEventsTable events={query.data} />
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Sortable, paginated table of {@link RuleEventEntry}s.
 *
 * Type/When headers toggle the sort (default newest-first by timestamp);
 * details are surfaced per-row as a one-line summary. The whole event log is
 * already in memory (≤50 entries), so sort/slice happens client-side.
 */
function RuleEventsTable({ events }: { events: RuleEventEntry[] }): ReactNode {
  const [sort, setSort] = useState<Sort>({ column: 'ts', dir: 'desc' });
  const [page, setPage] = useState(0);

  const sorted = [...events].sort((a, b) => {
    const cmp = sort.column === 'ts' ? a.ts - b.ts : a.type.localeCompare(b.type);
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const pageCount = Math.ceil(sorted.length / PAGE_SIZE);
  const current = Math.min(page, pageCount - 1);
  const rows = sorted.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  /** Toggle direction when re-clicking the active column, else switch to it. */
  function toggleSort(column: SortColumn): void {
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: 'desc' },
    );
    setPage(0);
  }

  return (
    <>
      <Table.Root variant="surface" size="1">
        <Table.Header>
          <Table.Row>
            <SortableHeader label="Type" column="type" sort={sort} onSort={toggleSort} />
            <SortableHeader label="When" column="ts" sort={sort} onSort={toggleSort} />
            <Table.ColumnHeaderCell>Details</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((event) => (
            <Table.Row key={eventKey(event)}>
              <Table.Cell>
                <Badge color={EVENT_COLORS[event.type]}>{event.type}</Badge>
              </Table.Cell>
              <Table.Cell>
                <Text size="1">{formatTimestamp(event.ts)}</Text>
              </Table.Cell>
              <Table.Cell>
                <Text size="1">{describeEvent(event)}</Text>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      {pageCount > 1 ? (
        <Flex align="center" justify="end" gap="3" mt="1">
          <Text size="1" color="gray">
            Page {current + 1} of {pageCount}
          </Text>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </Flex>
      ) : null}
    </>
  );
}

/**
 * A clickable column header that sorts the events table by {@link column} and
 * shows a chevron when it's the active sort.
 */
function SortableHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: SortColumn;
  sort: Sort;
  onSort: (column: SortColumn) => void;
}): ReactNode {
  const active = sort.column === column;
  return (
    <Table.ColumnHeaderCell>
      <Button
        type="button"
        variant="ghost"
        color="gray"
        size="1"
        onClick={() => onSort(column)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active ? (
          sort.dir === 'asc' ? (
            <ChevronUp size={12} aria-hidden="true" />
          ) : (
            <ChevronDown size={12} aria-hidden="true" />
          )
        ) : null}
      </Button>
    </Table.ColumnHeaderCell>
  );
}

/**
 * Stable React key for a {@link RuleEventEntry} row.
 *
 * Each fire writes multiple entries with the same `ts` but distinct `type`s
 * (one per action plus a trailing `Fired` umbrella); per-event detail fields
 * (`destinationName`, `key`, `body`) disambiguate within a single type when
 * one action is repeated.
 *
 * Falls back to a typed `firedAt` suffix on the rare overlap to keep keys
 * unique without prompting React's order-of-items warning.
 */
function eventKey(event: RuleEventEntry): string {
  const tail =
    event.type === RuleEventType.NotificationSent
      ? `:${event.destinationName}`
      : event.type === RuleEventType.StateSet || event.type === RuleEventType.StateRemoved
        ? `:${event.scope}:${event.key}`
        : '';
  return `${event.ts}:${event.type}${tail}:${event.firedAt ?? ''}`;
}

/**
 * One-line, human-readable summary for a {@link RuleEventEntry}.
 *
 * Lossless enough that the operator doesn't need to drill into a per-entry
 * detail view for the common cases; the trailing `Fired` umbrella carries
 * the inbound event reference for crash-debugging.
 */
function describeEvent(event: RuleEventEntry): string {
  switch (event.type) {
    case RuleEventType.NotificationSent:
      return `→ ${event.destinationName}: ${event.body}`;
    case RuleEventType.StateSet:
      return `${event.scope}.${event.key} = ${JSON.stringify(event.value.value)}`;
    case RuleEventType.StateRemoved:
      return `${event.scope}.${event.key} removed`;
    case RuleEventType.Error:
      return event.reason;
    case RuleEventType.CycleOverflow:
      return `cycle limit ${event.cycleLimit}`;
    case RuleEventType.Fired: {
      const inbound = event.context.inboundEvent;
      const period = 'period' in inbound ? inbound.period : undefined;
      return period === undefined
        ? `fired on ${inbound.kind}`
        : `fired on ${inbound.kind} (${period})`;
    }
  }
}
