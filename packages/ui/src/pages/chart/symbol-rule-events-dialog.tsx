import {
  type RuleEventEntry,
  RuleEventType,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import {
  Badge,
  Button,
  Dialog,
  Flex,
  IconButton,
  Skeleton,
  Spinner,
  Table,
  Text,
  Tooltip,
} from '@radix-ui/themes';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { formatTimestamp } from '../../lib/format.js';
import { useRules, useSymbolRuleEvents, useSymbolRuleEventsCount } from '../../lib/hooks/rules.js';

/** Rows the table renders per page. */
const PAGE_SIZE = 15;
/** Cap rendered on the trigger badge above this threshold. */
const COUNT_BADGE_CAP = 99;
/** Server-side cap on rows fetched per dialog open (the API hard-caps at 500). */
const MAX_ROWS_FETCHED = 500;

/**
 * Per-event color so the `Type` badge reads at a glance in a dense log.
 * Mirrors the rules-page events dialog. Gray is the fallback for anything new.
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
 * Which axis the events table is sorted by. The settled design (per issue
 * #425) makes both `firedAt` (wall-clock persistence) and `ts` (source bar /
 * tick timestamp) sortable; the default is newest-first on `firedAt`.
 */
type SortAxis = 'firedAt' | 'ts';

/** Direction the active sort column is applied. */
type SortDirection = 'asc' | 'desc';

/** The active sort: which axis and direction. */
interface SortState {
  /** The axis the table is sorted by. */
  axis: SortAxis;
  /** The direction (`asc` = oldest first, `desc` = newest first). */
  direction: SortDirection;
}

/**
 * Render the count for the Events trigger badge — uncapped integers up to
 * {@link COUNT_BADGE_CAP}; anything above renders as `99+`.
 */
function renderCount(count: number): string {
  if (count > COUNT_BADGE_CAP) return `${COUNT_BADGE_CAP}+`;
  return String(count);
}

/**
 * Render one `StateValue` payload for the `Detail` column — keeps the cell
 * compact (single token) regardless of which value variant the rule wrote.
 */
function renderStateValue(value: StateValue): string {
  switch (value.type) {
    case StateValueType.Bool:
      return value.value ? 'true' : 'false';
    case StateValueType.Number:
      return String(value.value);
    case StateValueType.String:
      return value.value;
  }
}

/**
 * Build a row key stable across re-renders — composes the entry's identity
 * fields so the same entry keeps the same `key` regardless of sort order.
 * Variant-specific fields disambiguate two entries that share `ts`/`firedAt`
 * (cascaded actions on the same fire).
 */
function entryKey(entry: RuleEventEntry): string {
  const variant =
    entry.type === RuleEventType.StateSet || entry.type === RuleEventType.StateRemoved
      ? `:${entry.key}`
      : entry.type === RuleEventType.NotificationSent
        ? `:${entry.destinationName}`
        : '';
  return `${entry.ruleId}|${entry.ts}|${entry.firedAt ?? 0}|${entry.type}${variant}`;
}

/**
 * Render one entry's variant-specific `Detail` cell content. The summary is
 * intentionally short — long bodies (`NotificationSent` template output) get
 * truncated by the CSS ellipsis at the cell level.
 */
function renderDetail(entry: RuleEventEntry): string {
  switch (entry.type) {
    case RuleEventType.Fired:
      return '';
    case RuleEventType.StateSet:
      return `${entry.key} = ${renderStateValue(entry.value)}`;
    case RuleEventType.StateRemoved:
      return entry.key;
    case RuleEventType.NotificationSent:
      return `${entry.destinationName}: ${entry.body}`;
    case RuleEventType.Error:
      return entry.reason;
    case RuleEventType.CycleOverflow:
      return `cycle limit: ${entry.cycleLimit}`;
  }
}

/**
 * The chart's bottom-bar Events panel — a trigger button labeled with the
 * current symbol's rule-event count, opening a dialog that lists each entry
 * with the two timestamps (`Source at` from the bar / tick that drove
 * evaluation, `Fired at` from the event-log adapter's persistence stamp),
 * the rule that produced it, its variant `Type`, and a `Detail` summary.
 *
 * Counts above `99` render as `99+` on the badge per issue #425.
 *
 * @param symbolId - the symbol whose events the dialog scopes to.
 */
export function SymbolRuleEventsDialog({ symbolId }: { symbolId: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const countQuery = useSymbolRuleEventsCount(symbolId);
  const count = countQuery.data ?? 0;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button
          variant="soft"
          color="gray"
          className="min-w-32 justify-center"
          aria-label={countQuery.isPending ? 'Events (loading)' : `Events (${renderCount(count)})`}
        >
          <History size={14} aria-hidden="true" />
          Events
          <Badge variant="soft" color="gray" radius="full">
            {countQuery.isPending ? <Spinner size="1" /> : renderCount(count)}
          </Badge>
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="900px">
        <Dialog.Title>
          Rule events{' '}
          <Text as="span" size="4" weight="regular" color="gray">
            {symbolId}
          </Text>
        </Dialog.Title>
        {open ? <EventsTableView symbolId={symbolId} /> : null}
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * The dialog's body — fetches the symbol's mirrored events (newest-first
 * server-side), then sorts + paginates them client-side per the user's
 * column toggles. The `useRules` lookup is used to render the rule's name
 * (rather than its opaque id).
 */
function EventsTableView({ symbolId }: { symbolId: string }): ReactNode {
  const eventsQuery = useSymbolRuleEvents(symbolId, { limit: MAX_ROWS_FETCHED });
  const rulesQuery = useRules();
  const [sort, setSort] = useState<SortState>({ axis: 'firedAt', direction: 'desc' });
  const [page, setPage] = useState(0);

  const entries = eventsQuery.data ?? [];
  const sorted = useMemo(() => {
    const factor = sort.direction === 'desc' ? -1 : 1;
    return [...entries].sort((a, b) => {
      const left = sort.axis === 'firedAt' ? (a.firedAt ?? 0) : a.ts;
      const right = sort.axis === 'firedAt' ? (b.firedAt ?? 0) : b.ts;
      return factor * (left - right);
    });
  }, [entries, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const rulesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const rule of rulesQuery.data ?? []) map.set(rule.id, rule.name);
    return map;
  }, [rulesQuery.data]);

  function toggleSort(axis: SortAxis): void {
    setSort((current) =>
      current.axis === axis
        ? { axis, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { axis, direction: 'desc' },
    );
    setPage(0);
  }

  if (eventsQuery.isPending) {
    return <Skeleton height="1.25rem" width="10rem" />;
  }
  if (eventsQuery.isError) {
    return (
      <Text size="2" color="red" role="alert">
        {eventsQuery.error.message}
      </Text>
    );
  }
  return (
    <Flex direction="column" gap="3" mt="3">
      <Table.Root variant="surface" size="1">
        <Table.Header>
          <Table.Row>
            <SortableHeader
              label="Source at"
              tooltip="Candle / bar / tick timestamp that drove evaluation"
              axis="ts"
              sort={sort}
              onSort={toggleSort}
            />
            <SortableHeader
              label="Fired at"
              tooltip="Wall-clock timestamp when the event was persisted"
              axis="firedAt"
              sort={sort}
              onSort={toggleSort}
            />
            <Table.ColumnHeaderCell>Rule</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Detail</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {slice.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={5}>
                <Text size="2" color="gray">
                  No events for this symbol.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            slice.map((entry) => (
              <Table.Row key={entryKey(entry)}>
                <Table.Cell className="font-mono">{formatTimestamp(entry.ts)}</Table.Cell>
                <Table.Cell className="font-mono">
                  {entry.firedAt !== undefined ? formatTimestamp(entry.firedAt) : '—'}
                </Table.Cell>
                <Table.Cell>{rulesById.get(entry.ruleId) ?? entry.ruleId}</Table.Cell>
                <Table.Cell>
                  <Badge color={EVENT_COLORS[entry.type]}>{entry.type}</Badge>
                </Table.Cell>
                <Table.Cell className="break-words">{renderDetail(entry)}</Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table.Root>
      <Flex align="center" justify="between" gap="2">
        <Text size="2" color="gray">
          Page {safePage + 1} of {pageCount}
        </Text>
        <Flex gap="2" align="center">
          <IconButton
            type="button"
            variant="soft"
            color="gray"
            aria-label="Previous page"
            disabled={safePage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            variant="soft"
            color="gray"
            aria-label="Next page"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </IconButton>
        </Flex>
      </Flex>
    </Flex>
  );
}

/**
 * A column header whose label is a button that drives sorting on the given
 * axis. The header carries a tooltip that disambiguates source-ts vs
 * wall-clock (per issue #425's "must be visually distinguishable" criterion).
 */
function SortableHeader({
  label,
  tooltip,
  axis,
  sort,
  onSort,
}: {
  label: string;
  tooltip: string;
  axis: SortAxis;
  sort: SortState;
  onSort: (axis: SortAxis) => void;
}): ReactNode {
  const active = sort.axis === axis;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  const Arrow = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : null;
  return (
    <Table.ColumnHeaderCell aria-sort={ariaSort}>
      <Tooltip content={tooltip}>
        <button
          type="button"
          onClick={() => onSort(axis)}
          aria-label={`Sort by ${label}`}
          className="inline-flex items-center gap-1 font-medium text-[var(--gray-12)]"
        >
          {label}
          {Arrow ? <Arrow className="h-3.5 w-3.5 text-[var(--gray-9)]" aria-hidden="true" /> : null}
        </button>
      </Tooltip>
    </Table.ColumnHeaderCell>
  );
}
