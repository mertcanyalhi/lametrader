import type { BacktestOpenPosition, BacktestSummary, BacktestTrade } from '@lametrader/core';
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  SegmentedControl,
  Table,
  Tabs,
  Text,
} from '@radix-ui/themes';
import { type ReactNode, useMemo, useState } from 'react';
import { formatChange, formatDuration, formatPrice } from '../../lib/format.js';
import { exitReasonLabel, formatPercent } from './backtest-format.js';
import { bucketDailyPnl } from './daily-pnl.js';
import { DailyPnlChart } from './daily-pnl-chart.js';
import { PnlBaselineChart } from './pnl-baseline-chart.js';
import { cumulativePnl, perTradePnl } from './pnl-series.js';

/** The em-dash placeholder for a cell a row has no value for (the open row's exit columns). */
const EMPTY_CELL = '—';

/** Milliseconds in one day — converts the summary's fractional-days average into a span. */
const MS_PER_DAY = 86_400_000;

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

/**
 * A metric card's Radix accent scale — the sign-derived trio (green up, red down,
 * neutral flat) plus the warm-to-cool ramp the win-rate metric grades itself on.
 * Each name is a Radix color scale, so its background is `var(--<name>-a3)`.
 */
type MetricColor = 'grass' | 'red' | 'gray' | 'orange' | 'yellow' | 'green';

/** Column the Trades table can be sorted on (entry time or per-trade P/L). */
type SortKey = 'entry' | 'pnl';

/** Sort direction toggled by clicking a sortable header. */
type SortDir = 'asc' | 'desc';

/** Map a signed number to its tone — positive green, negative red, zero neutral. */
function signTone(value: number): MetricColor {
  if (value > 0) return 'grass';
  if (value < 0) return 'red';
  return 'gray';
}

/**
 * Grade a win-rate percentage on a monotonic worse-to-better ramp — red under
 * 25%, orange under 50%, yellow under 75%, green at 75%+ — so the metric's color
 * reads the strategy's hit rate at a glance (0% red … 100% green).
 */
function winRateColor(pct: number): MetricColor {
  if (pct < 25) return 'red';
  if (pct < 50) return 'orange';
  if (pct < 75) return 'yellow';
  return 'green';
}

/**
 * The run's results panel — two tabs the right ⅓ fills in as frames arrive and
 * after completion: **Summary** (the full metric block plus a chart that toggles
 * between the per-exit-day Daily P&L histogram, the cumulative equity curve, and
 * the per-trade win/lose series) and **Trades** (closed trades plus the open
 * position as an unrealized final row).
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
      </Tabs.List>
      <Box pt="3">
        <Tabs.Content value="summary">
          <SummaryTab trades={trades} summary={summary} openPosition={openPosition} />
        </Tabs.Content>
        <Tabs.Content value="trades">
          <TradesTab trades={trades} openPosition={openPosition} />
        </Tabs.Content>
      </Box>
    </Tabs.Root>
  );
}

/** Which chart the Summary tab's toggle currently shows. */
type SummaryChart = 'daily' | 'equity' | 'trades';

/**
 * The Summary tab: the full metric block — realized aggregates (total P/L, ROI %,
 * win rate), trade counts, and per-trade averages, plus the open-position
 * unrealized-P/L line when a position is still open — above a chart that toggles
 * between the per-exit-day Daily P&L histogram, the cumulative equity curve, and
 * the per-trade win/lose series. Each metric is a card tinted by the sign of its
 * value (win rate on its own ramp; unsigned metrics stay neutral).
 */
function SummaryTab({
  trades,
  summary,
  openPosition,
}: {
  trades: readonly BacktestTrade[];
  summary: BacktestSummary;
  openPosition: BacktestOpenPosition | undefined;
}): ReactNode {
  const [chart, setChart] = useState<SummaryChart>('daily');
  const bars = useMemo(() => bucketDailyPnl(trades), [trades]);
  const equity = useMemo(() => cumulativePnl(trades), [trades]);
  const perTrade = useMemo(() => perTradePnl(trades), [trades]);
  const winRate = summary.tradeCount > 0 ? (summary.winners / summary.tradeCount) * 100 : 0;

  return (
    <Flex direction="column" gap="3">
      <Grid columns={{ initial: '2', sm: '3' }} gap="2" aria-label="Summary">
        <Metric
          label="Total P/L"
          value={formatChange(summary.totalPnl)}
          amount={summary.totalPnl}
        />
        <Metric label="ROI %" value={formatPercent(summary.roiPct)} amount={summary.roiPct} />
        <Metric label="Win rate" value={`${winRate.toFixed(1)}%`} color={winRateColor(winRate)} />
        <Metric
          label="Avg P/L per trade"
          value={formatChange(summary.avgPnlPerTrade)}
          amount={summary.avgPnlPerTrade}
        />
        <Metric
          label="Avg ROI per trade"
          value={formatPercent(summary.avgRoiPct)}
          amount={summary.avgRoiPct}
        />
        <Metric label="Trades" value={String(summary.tradeCount)} />
        <Metric label="Winners / losers" value={`${summary.winners} / ${summary.losers}`} />
        <Metric
          label="Avg period in trade"
          value={formatDuration(summary.avgDaysInTrade * MS_PER_DAY)}
        />
        {openPosition ? (
          <Metric
            label="Open position (unrealized)"
            value={formatChange(openPosition.unrealizedPnl)}
            amount={openPosition.unrealizedPnl}
          />
        ) : null}
      </Grid>

      <SegmentedControl.Root
        size="1"
        value={chart}
        onValueChange={(value) => setChart(value as SummaryChart)}
        aria-label="Chart"
      >
        <SegmentedControl.Item value="daily">Daily P&amp;L</SegmentedControl.Item>
        <SegmentedControl.Item value="equity">Equity curve</SegmentedControl.Item>
        <SegmentedControl.Item value="trades">Win/lose per trade</SegmentedControl.Item>
      </SegmentedControl.Root>
      <div className="h-40 w-full">
        {chart === 'daily' ? (
          <DailyPnlChart bars={bars} />
        ) : chart === 'equity' ? (
          <PnlBaselineChart points={equity} />
        ) : (
          <PnlBaselineChart points={perTrade} />
        )}
      </div>
    </Flex>
  );
}

/**
 * The Trades tab: one sortable, paginated row per closed trade (entry/exit times,
 * holding duration, buy/sell prices, per-trade P/L amount and ROI %, and exit
 * reason), with the open position pinned as the final row on the last page — its
 * exit columns blank and its P/L flagged unrealized.
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
            <Table.ColumnHeaderCell>Duration</Table.ColumnHeaderCell>
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
              <Table.Cell>{formatDuration(trade.exitTs - trade.entryTs)}</Table.Cell>
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
 * One metric as a color-coded card in the grid: a centered vertical stack with
 * the value on top as the larger, accented text and the label below it as smaller
 * muted text. The accent is an explicit `color` when given (e.g. the win-rate
 * ramp), else derived from the sign of `amount` (green positive, red negative,
 * neutral zero); a metric with neither stays neutral. The card background is the
 * accent's `-a3` alpha step.
 */
function Metric({
  label,
  value,
  amount,
  color,
}: {
  label: string;
  value: string;
  amount?: number;
  color?: MetricColor;
}): ReactNode {
  const tone: MetricColor = color ?? (amount === undefined ? 'gray' : signTone(amount));
  return (
    <Card size="1" style={{ background: `var(--${tone}-a3)` }}>
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
