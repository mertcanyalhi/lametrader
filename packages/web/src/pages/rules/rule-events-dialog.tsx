import { type Rule, type RuleEventEntry, RuleEventType } from '@lametrader/core';
import { Badge, Callout, Dialog, Flex, Skeleton, Table, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { formatTimestamp } from '../../lib/format.js';
import { useRuleEvents } from '../../lib/hooks/rules.js';

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
 * Opened from the rules table's Events action; fetches via {@link useRuleEvents}.
 * Pagination is out of scope here (the default 50-entry page covers normal
 * inspection; deeper history goes through the dedicated symbol-events view).
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
      <Dialog.Content maxWidth="720px">
        <Dialog.Title>Events — {rule.name}</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Newest first; the 50 most recent entries.
        </Dialog.Description>
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
 * Dense table of {@link RuleEventEntry}s.
 *
 * Two columns: a type badge + the source timestamp; details are surfaced
 * per-row as a one-line summary (rendered destination + body, mutated key,
 * etc.) so the user gets the full picture without expanding rows.
 */
function RuleEventsTable({ events }: { events: RuleEventEntry[] }): ReactNode {
  return (
    <Table.Root variant="surface" size="1">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>When</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Details</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {events.map((event) => (
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
    case RuleEventType.Fired:
      return `fired on ${event.context.inboundEvent.kind}`;
  }
}
