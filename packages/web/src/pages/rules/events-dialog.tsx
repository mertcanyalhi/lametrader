import { type RuleEventEntry, RuleEventType } from '@lametrader/core';
import { Box, Button, Callout, Dialog, Flex, Skeleton, Table, Text } from '@radix-ui/themes';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiFetch } from '../../lib/api-fetch.js';
import { ruleEventsKey, symbolRuleEventsKey } from '../../lib/hooks/rules.js';

/** Page size we request from the API; matches the server default. */
const PAGE_SIZE = 50;

/**
 * What the modal is viewing — either a single rule's embedded events or every
 * rule event recorded against a watched symbol. The discriminant drives the
 * page-fetcher (the endpoint, the cache key) and the dialog title.
 */
export type EventsDialogMode =
  | { kind: 'rule'; ruleId: string; ruleName: string }
  | { kind: 'symbol'; symbolId: string };

/**
 * The reusable "rule events" modal. Mounts as a Radix `<Dialog>`; the body
 * is a small Radix table of `timestamp` / `kind` / `payload summary`. A
 * "Load more" button drives `useInfiniteQuery` with the oldest event's `ts`
 * as the next page's `before` cursor; the loop terminates when a page
 * returns fewer than {@link PAGE_SIZE} rows.
 *
 * Both modes share this component — `rule` mode hits
 * `GET /rules/:id/events`, `symbol` mode hits
 * `GET /symbols/:id/rule-events`. The page-fetcher and cache key swap
 * based on {@link EventsDialogMode}.
 */
export function EventsDialog({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: EventsDialogMode;
}): ReactNode {
  const query = useInfiniteQuery<RuleEventEntry[], Error>({
    queryKey: keyFor(mode),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => fetchPage(mode, pageParam as number | undefined),
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]?.ts,
  });
  const events = query.data?.pages.flat() ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>{titleFor(mode)}</Dialog.Title>
        {query.isPending ? (
          <Skeleton height="3rem" />
        ) : query.isError ? (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{query.error.message}</Callout.Text>
          </Callout.Root>
        ) : events.length === 0 ? (
          <Text size="2" color="gray" role="status">
            No events recorded yet.
          </Text>
        ) : (
          <Table.Root variant="surface" size="1">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Timestamp</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Kind</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Payload</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {events.map((event, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: events stream in newest-first order; no stable per-row id.
                <Table.Row key={`${event.ts}-${event.type}-${index}`}>
                  <Table.Cell>{formatTs(event.ts)}</Table.Cell>
                  <Table.Cell>{event.type}</Table.Cell>
                  <Table.Cell>
                    <Text size="2" color="gray">
                      {summarize(event)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
        <Flex gap="3" mt="4" justify="between" align="center">
          <Box>
            {query.hasNextPage ? (
              <Button
                type="button"
                variant="soft"
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
                disabled={query.isFetchingNextPage}
              >
                Load more
              </Button>
            ) : null}
          </Box>
          <Dialog.Close>
            <Button type="button" variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Stable React Query key for the current mode, sharing the rule hooks' roots. */
function keyFor(mode: EventsDialogMode): readonly unknown[] {
  if (mode.kind === 'rule') return [...ruleEventsKey(mode.ruleId), 'infinite'] as const;
  return [...symbolRuleEventsKey(mode.symbolId), 'infinite'] as const;
}

/** Fetch one page; `before` is the cursor for "older than this timestamp". */
async function fetchPage(
  mode: EventsDialogMode,
  before: number | undefined,
): Promise<RuleEventEntry[]> {
  const search = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before !== undefined) search.set('before', String(before));
  const qs = search.toString();
  const path =
    mode.kind === 'rule'
      ? `/rules/${encodeURIComponent(mode.ruleId)}/events?${qs}`
      : `/symbols/${encodeURIComponent(mode.symbolId)}/rule-events?${qs}`;
  return apiFetch<RuleEventEntry[]>(path);
}

function titleFor(mode: EventsDialogMode): string {
  if (mode.kind === 'rule') return `Events — ${mode.ruleName}`;
  return `Events — ${mode.symbolId}`;
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * One-line summary of the event's per-variant payload. Lazy: full event
 * inspection (JSON view) can land later when reading a fired condition's
 * left/right values matters in practice.
 */
function summarize(event: RuleEventEntry): string {
  switch (event.type) {
    case RuleEventType.Fired:
      return event.symbolId;
    case RuleEventType.CycleOverflow:
      return `cycle limit ${event.cycleLimit}`;
    case RuleEventType.StateSet:
      return `${event.scope}.${event.key} = ${valueText(event.value)}`;
    case RuleEventType.StateRemoved:
      return `${event.scope}.${event.key}`;
    case RuleEventType.NotificationSent:
      return `${event.destinationName}: ${event.body.slice(0, 80)}`;
    case RuleEventType.Error:
      return event.reason;
    case RuleEventType.Expired:
      return event.symbolId;
  }
}

function valueText(value: { value: string | number | boolean }): string {
  return String(value.value);
}
