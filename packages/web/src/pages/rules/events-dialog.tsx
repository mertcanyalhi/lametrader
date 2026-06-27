import {
  type FiredRuleEvent,
  type RuleEventContext,
  type RuleEventEntry,
  RuleEventType,
} from '@lametrader/core';
import {
  Box,
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  Skeleton,
  Table,
  Text,
  Tooltip,
} from '@radix-ui/themes';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { apiFetch } from '../../lib/api-fetch.js';
import { formatTimestamp } from '../../lib/format.js';
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
  const [contextEvent, setContextEvent] = useState<FiredRuleEvent | null>(null);

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
                <Table.ColumnHeaderCell>Bar time</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Fired at</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Kind</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Payload</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell> </Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {events.map((event, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: events stream in newest-first order; no stable per-row id.
                <Table.Row key={`${event.ts}-${event.type}-${index}`}>
                  <Table.Cell>{formatTimestamp(event.ts)}</Table.Cell>
                  <Table.Cell>
                    {event.firedAt === undefined ? (
                      <Text size="2" color="gray">
                        —
                      </Text>
                    ) : (
                      formatTimestamp(event.firedAt)
                    )}
                  </Table.Cell>
                  <Table.Cell>{event.type}</Table.Cell>
                  <Table.Cell>
                    <Text size="2" color="gray">
                      {summarize(event)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {hasContext(event) ? (
                      <Tooltip content="Show fire context">
                        <IconButton
                          type="button"
                          size="1"
                          variant="ghost"
                          color="gray"
                          aria-label="Show fire context"
                          onClick={() => setContextEvent(event)}
                        >
                          <Info size={14} />
                        </IconButton>
                      </Tooltip>
                    ) : null}
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
        <FireContextDialog
          event={contextEvent}
          onOpenChange={(open) => {
            if (!open) setContextEvent(null);
          }}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Whether `event` carries the per-event context captured at fire-time
 * (#304). Historical entries written before context capture have no
 * payload to show, so the info icon is suppressed for them.
 */
function hasContext(
  event: RuleEventEntry,
): event is FiredRuleEvent & { context: RuleEventContext } {
  return event.type === RuleEventType.Fired && event.context !== undefined;
}

/**
 * Nested modal showing the `Fired` event's captured context — the inbound
 * `RuleEvent` and the firing symbol's OHLCV snapshot. Renders nothing when
 * `event` is `null` so the parent dialog can drive open/close via state.
 */
function FireContextDialog({
  event,
  onOpenChange,
}: {
  event: FiredRuleEvent | null;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  if (event === null || event.context === undefined) return null;
  const { inboundEvent, lookupSnapshot } = event.context;
  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Fire context</Dialog.Title>
        <Box mt="3">
          <Text size="2" weight="bold">
            Inbound event
          </Text>
          <Table.Root variant="surface" size="1" mt="1">
            <Table.Body>
              <Table.Row>
                <Table.RowHeaderCell>kind</Table.RowHeaderCell>
                <Table.Cell>{inboundEvent.kind}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.RowHeaderCell>ts</Table.RowHeaderCell>
                <Table.Cell>{formatTimestamp(inboundEvent.ts)}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.RowHeaderCell>symbolId</Table.RowHeaderCell>
                <Table.Cell>{inboundEvent.symbolId ?? '—'}</Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Box>
        <Box mt="3">
          <Text size="2" weight="bold">
            Lookup snapshot
          </Text>
          <Table.Root variant="surface" size="1" mt="1">
            <Table.Body>
              <Table.Row>
                <Table.RowHeaderCell>current</Table.RowHeaderCell>
                <Table.Cell>{lookupSnapshot.current ?? '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.RowHeaderCell>open</Table.RowHeaderCell>
                <Table.Cell>{lookupSnapshot.open ?? '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.RowHeaderCell>high</Table.RowHeaderCell>
                <Table.Cell>{lookupSnapshot.high ?? '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.RowHeaderCell>low</Table.RowHeaderCell>
                <Table.Cell>{lookupSnapshot.low ?? '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.RowHeaderCell>close</Table.RowHeaderCell>
                <Table.Cell>{lookupSnapshot.close ?? '—'}</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.RowHeaderCell>volume</Table.RowHeaderCell>
                <Table.Cell>{lookupSnapshot.volume ?? '—'}</Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Box>
        <Flex justify="end" mt="4">
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
