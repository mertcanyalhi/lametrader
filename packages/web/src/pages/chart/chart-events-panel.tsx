import { type RuleEventEntry, RuleEventType } from '@lametrader/core';
import { Box, Button, Callout, Flex, IconButton, Skeleton, Table, Text } from '@radix-ui/themes';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import { apiFetch } from '../../lib/api-fetch.js';
import {
  getStoredChartEventsPanelOpen,
  setStoredChartEventsPanelOpen,
} from '../../lib/chart-events-panel.js';
import { symbolRuleEventsKey } from '../../lib/hooks/rules.js';

const PAGE_SIZE = 50;

/**
 * The chart's collapsible Events panel — newest-first list of rule events
 * for the current symbol with "Load more" pagination. The collapsed state
 * persists across reloads (see `lib/chart-events-panel.ts`).
 *
 * @param symbolId - the chart's current symbol id.
 */
export function ChartEventsPanel({ symbolId }: { symbolId: string }): ReactNode {
  const [open, setOpenState] = useState<boolean>(getStoredChartEventsPanelOpen);
  const setOpen = useCallback((next: boolean) => {
    setStoredChartEventsPanelOpen(next);
    setOpenState(next);
  }, []);
  const query = useInfiniteQuery<RuleEventEntry[], Error>({
    queryKey: [...symbolRuleEventsKey(symbolId), 'panel'] as const,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => fetchPage(symbolId, pageParam as number | undefined),
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]?.ts,
    enabled: open,
  });
  const events = query.data?.pages.flat() ?? [];

  return (
    <Box role="region" aria-label="Symbol events" className="border-t border-[var(--gray-a5)] pt-2">
      <Flex align="center" justify="between">
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          aria-label={open ? 'Collapse events panel' : 'Expand events panel'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronUp size={14} aria-hidden="true" />
          )}
        </IconButton>
        <Text size="2" weight="medium">
          Events
        </Text>
        <Box />
      </Flex>
      {open ? (
        <Box mt="2">
          {query.isPending ? (
            <Skeleton height="2rem" />
          ) : query.isError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{query.error.message}</Callout.Text>
            </Callout.Root>
          ) : events.length === 0 ? (
            <Text size="2" color="gray" role="status">
              No events for this symbol yet.
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
                  // biome-ignore lint/suspicious/noArrayIndexKey: events stream newest-first; no stable per-row id.
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
          {query.hasNextPage ? (
            <Box mt="2">
              <Button
                type="button"
                variant="soft"
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
                disabled={query.isFetchingNextPage}
              >
                Load more
              </Button>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

async function fetchPage(symbolId: string, before: number | undefined): Promise<RuleEventEntry[]> {
  const search = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before !== undefined) search.set('before', String(before));
  return apiFetch<RuleEventEntry[]>(
    `/symbols/${encodeURIComponent(symbolId)}/rule-events?${search.toString()}`,
  );
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function summarize(event: RuleEventEntry): string {
  switch (event.type) {
    case RuleEventType.Fired:
      return event.symbolId;
    case RuleEventType.CycleOverflow:
      return `cycle limit ${event.cycleLimit}`;
    case RuleEventType.StateSet:
      return `${event.scope}.${event.key} = ${String(event.value.value)}`;
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
