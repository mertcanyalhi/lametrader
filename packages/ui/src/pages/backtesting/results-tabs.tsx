import type { BacktestOpenPosition, BacktestSummary, BacktestTrade } from '@lametrader/core';
import { Badge, Box, Button, Card, Flex, Grid, Table, Tabs, Text } from '@radix-ui/themes';
import { type ReactNode, useMemo, useState } from 'react';
import { formatChange, formatPrice } from '../../lib/format.js';
import { exitReasonLabel, formatPercent } from './backtest-format.js';
import { bucketDailyPnl } from './daily-pnl.js';
import { DailyPnlChart } from './daily-pnl-chart.js';

/** The em-dash placeholder for a cell a row has no value for (the open row's exit columns). */
const EMPTY_CELL = '—';

/**
 * Format an epoch-ms timestamp as `YYYY-MM-DD HH:mm` (UTC) for the Trades table —
 * the date plus 24-hour time, dropping the seconds/ms noise of the app's shared
 * timestamp formatter since a trade's entry/exit reads clearly to the minute.
 */
function formatTradeTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

/** How many closed trades fill one page of the Trades table before pagination kicks in. */
const PAGE_SIZE = 10;

/** A metric's sign-derived Radix accent: green up, red down, neutral flat. */
type Tone = 'grass' | 'red' | 'gray';

/** Column the Trades table can be sorted on (entry time or per-trade P/L). */
type SortKey = 'entry' | 'pnl';

/** Sort direction toggled by clicking a sortable header. */
type SortDir = 'asc' | 'desc';

/** The subtle card-background accent-alpha var for each tone (Radix scale, never a hex). */
const TONE_BG: Record<Tone, string> = {
  grass: 'var(--grass-a3)',
  red: 'var(--red-a3)',
  gray: 'var(--gray-a3)',
};

/** Map a signed number to its tone — positive green, negative red, zero neutral. */
function signTone(value: number): Tone {
  if (value > 0) return 'grass';
  if (value < 0) return 'red';
  return 'gray';
}

/**
 * The run's results panel — the three tabs the right ⅓ fills in as frames arrive
 * and after completion: **Summary** (realized aggregates + the open-position
 * unrealized line), **Trades** (closed trades plus the open position as an
 * unrealized final row), and **Daily P&L** (the per-exit-day histogram over a
 * five-item summary block).
 *
 * Every value is read straight off the streamed run view, so the tabs track the
 * live run and render a loaded backtest identically.
 *
 * @param trades - the run's closed trades, in exit order.
 * @param summary - the running summary over the closed trades.
 * @param openPosition - the position still open at the frontier, if any.
 */
export function ResultsTabs({
  trades,
  summary,
  openPosition,
}: {
  trades: readonly BacktestTrade[];
  summary: BacktestSummary;
  openPosition: BacktestOpenPosition | undefined;
}): ReactNode {
  return (
    <Tabs.Root defaultValue="summary">
      <Tabs.List>
        <Tabs.Trigger value="summary">Summary</Tabs.Trigger>
        <Tabs.Trigger value="trades">Trades</Tabs.Trigger>
        <Tabs.Trigger value="daily">Daily P&amp;L</Tabs.Trigger>
      </Tabs.List>
      <Box pt="3">
        <Tabs.Content value="summary">
          <SummaryTab summary={summary} openPosition={openPosition} />
        </Tabs.Content>
        <Tabs.Content value="trades">
          <TradesTab trades={trades} openPosition={openPosition} />
        </Tabs.Content>
        <Tabs.Content value="daily">
          <DailyPnlTab trades={trades} summary={summary} />
        </Tabs.Content>
      </Box>
    </Tabs.Root>
  );
}

/**
 * The Summary tab: total P/L, ROI %, and average P/L per trade over the closed
 * trades, plus a separate open-position unrealized-P/L line when a position is
 * still open. Each metric is a card tinted by the sign of its value.
 */
function SummaryTab({
  summary,
  openPosition,
}: {
  summary: BacktestSummary;
  openPosition: BacktestOpenPosition | undefined;
}): ReactNode {
  return (
    <Grid columns={{ initial: '2', sm: '3' }} gap="2" aria-label="Summary">
      <Metric label="Total P/L" value={formatChange(summary.totalPnl)} amount={summary.totalPnl} />
      <Metric label="ROI %" value={formatPercent(summary.roiPct)} amount={summary.roiPct} />
      <Metric
        label="Avg P/L per trade"
        value={formatChange(summary.avgPnlPerTrade)}
        amount={summary.avgPnlPerTrade}
      />
      {openPosition ? (
        <Metric
          label="Open position (unrealized)"
          value={formatChange(openPosition.unrealizedPnl)}
          amount={openPosition.unrealizedPnl}
        />
      ) : null}
    </Grid>
  );
}

/**
 * The Trades tab: one sortable, paginated row per closed trade (entry/exit times,
 * buy/sell prices, per-trade P/L amount and ROI %, and exit reason), with the open
 * position pinned as the final row on the last page — its exit columns blank and its
 * P/L flagged unrealized.
 */
function TradesTab({
  trades,
  openPosition,
}: {
  trades: readonly BacktestTrade[];
  openPosition: BacktestOpenPosition | undefined;
}): ReactNode {
  const [sortKey, setSortKey] = useState<SortKey>('entry');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageIndex, setPageIndex] = useState(0);

  const sorted = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1;
    return [...trades].sort(
      (a, b) => factor * (sortKey === 'entry' ? a.entryTs - b.entryTs : a.pnl - b.pnl),
    );
  }, [trades, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageTrades = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const showOpen = openPosition !== undefined && page === pageCount - 1;

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPageIndex(0);
  }

  if (trades.length === 0 && !openPosition) {
    return (
      <Text size="2" color="gray">
        No trades yet.
      </Text>
    );
  }
  return (
    <Flex direction="column" gap="2">
      <Table.Root size="1" aria-label="Trades">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>
              <SortButton
                label="Entry"
                active={sortKey === 'entry'}
                dir={sortDir}
                onClick={() => toggleSort('entry')}
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Exit</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Buy</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Sell</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>
              <SortButton
                label="P/L"
                active={sortKey === 'pnl'}
                dir={sortDir}
                onClick={() => toggleSort('pnl')}
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>ROI %</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Reason</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {pageTrades.map((trade) => (
            <Table.Row key={`${trade.entryTs}-${trade.exitTs}`}>
              <Table.Cell>{formatTradeTime(trade.entryTs)}</Table.Cell>
              <Table.Cell>{formatTradeTime(trade.exitTs)}</Table.Cell>
              <Table.Cell>{formatPrice(trade.entryPrice)}</Table.Cell>
              <Table.Cell>{formatPrice(trade.exitPrice)}</Table.Cell>
              <Table.Cell>
                <Text color={signTone(trade.pnl)}>{formatChange(trade.pnl)}</Text>
              </Table.Cell>
              <Table.Cell>
                <Text color={signTone(trade.roiPct)}>{formatPercent(trade.roiPct)}</Text>
              </Table.Cell>
              <Table.Cell>{exitReasonLabel(trade.exitReason)}</Table.Cell>
            </Table.Row>
          ))}
          {showOpen && openPosition ? (
            <Table.Row>
              <Table.Cell>{formatTradeTime(openPosition.entryTs)}</Table.Cell>
              <Table.Cell>{EMPTY_CELL}</Table.Cell>
              <Table.Cell>{formatPrice(openPosition.entryPrice)}</Table.Cell>
              <Table.Cell>{EMPTY_CELL}</Table.Cell>
              <Table.Cell>
                <Flex align="center" gap="2">
                  <Text color={signTone(openPosition.unrealizedPnl)}>
                    {formatChange(openPosition.unrealizedPnl)}
                  </Text>
                  <Badge color="amber" variant="soft">
                    unrealized
                  </Badge>
                </Flex>
              </Table.Cell>
              <Table.Cell>{EMPTY_CELL}</Table.Cell>
              <Table.Cell>Open</Table.Cell>
            </Table.Row>
          ) : null}
        </Table.Body>
      </Table.Root>
      {pageCount > 1 ? (
        <Flex justify="between" align="center" gap="3">
          <Text size="1" color="gray">
            Page {page + 1} of {pageCount}
          </Text>
          <Flex gap="2">
            <Button
              size="1"
              variant="soft"
              disabled={page === 0}
              onClick={() => setPageIndex(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="1"
              variant="soft"
              disabled={page >= pageCount - 1}
              onClick={() => setPageIndex(page + 1)}
            >
              Next
            </Button>
          </Flex>
        </Flex>
      ) : null}
    </Flex>
  );
}

/**
 * The Daily P&L tab: the per-exit-day histogram above the five-item summary
 * block (number of trades, winners/losers, average ROI per trade, total P/L,
 * average days in trade). Signed metrics are tinted by their sign.
 */
function DailyPnlTab({
  trades,
  summary,
}: {
  trades: readonly BacktestTrade[];
  summary: BacktestSummary;
}): ReactNode {
  const bars = useMemo(() => bucketDailyPnl(trades), [trades]);
  return (
    <Flex direction="column" gap="3">
      <div className="h-40 w-full">
        <DailyPnlChart bars={bars} />
      </div>
      <Grid columns={{ initial: '2', sm: '3' }} gap="2" aria-label="Daily P&L summary">
        <Metric label="Trades" value={String(summary.tradeCount)} />
        <Metric label="Winners / losers" value={`${summary.winners} / ${summary.losers}`} />
        <Metric
          label="Avg ROI per trade"
          value={formatPercent(summary.avgRoiPct)}
          amount={summary.avgRoiPct}
        />
        <Metric
          label="Total P/L"
          value={formatChange(summary.totalPnl)}
          amount={summary.totalPnl}
        />
        <Metric label="Avg days in trade" value={summary.avgDaysInTrade.toFixed(2)} />
      </Grid>
    </Flex>
  );
}

/**
 * One metric as a color-coded card in the grid: a centered vertical stack with
 * the value on top as the larger, sign-accented text and the label below it as
 * smaller muted text. The card is tinted and the value accented by the sign of
 * `amount` (green positive, red negative, neutral zero); a metric with no signed
 * value (`amount` omitted) stays neutral.
 */
function Metric({
  label,
  value,
  amount,
}: {
  label: string;
  value: string;
  amount?: number;
}): ReactNode {
  const tone = amount === undefined ? 'gray' : signTone(amount);
  return (
    <Card size="1" style={{ background: TONE_BG[tone] }}>
      <Flex direction="column" align="center" gap="1">
        <Text size="4" weight="bold" color={tone}>
          {value}
        </Text>
        <Text size="1" color="gray">
          {label}
        </Text>
      </Flex>
    </Card>
  );
}

/**
 * A sortable column header — a ghost button whose accessible name is the plain
 * column label; the asc/desc caret is decorative (`aria-hidden`) so the name
 * stays queryable by label alone.
 */
function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}): ReactNode {
  return (
    <Button variant="ghost" size="1" color="gray" onClick={onClick}>
      {label}
      <Text aria-hidden="true">{active ? (dir === 'asc' ? '▲' : '▼') : ''}</Text>
    </Button>
  );
}
