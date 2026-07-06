import type { BacktestOpenPosition, BacktestSummary, BacktestTrade } from '@lametrader/core';
import { Badge, Box, Flex, Table, Tabs, Text } from '@radix-ui/themes';
import { type ReactNode, useMemo } from 'react';
import { formatChange, formatPrice, formatTimestamp } from '../../lib/format.js';
import { exitReasonLabel, formatPercent } from './backtest-format.js';
import { bucketDailyPnl } from './daily-pnl.js';
import { DailyPnlChart } from './daily-pnl-chart.js';

/** The em-dash placeholder for a cell a row has no value for (the open row's exit columns). */
const EMPTY_CELL = '—';

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
 * still open.
 */
function SummaryTab({
  summary,
  openPosition,
}: {
  summary: BacktestSummary;
  openPosition: BacktestOpenPosition | undefined;
}): ReactNode {
  return (
    <Flex direction="column" gap="2" aria-label="Summary">
      <Metric label="Total P/L" value={formatChange(summary.totalPnl)} />
      <Metric label="ROI %" value={formatPercent(summary.roiPct)} />
      <Metric label="Avg P/L per trade" value={formatChange(summary.avgPnlPerTrade)} />
      {openPosition ? (
        <Metric
          label="Open position (unrealized)"
          value={formatChange(openPosition.unrealizedPnl)}
        />
      ) : null}
    </Flex>
  );
}

/**
 * The Trades tab: one row per closed trade (entry/exit times, buy/sell prices,
 * P/L, ROI %, and exit reason), with the open position as the final row — its
 * exit columns blank and its P/L flagged unrealized.
 */
function TradesTab({
  trades,
  openPosition,
}: {
  trades: readonly BacktestTrade[];
  openPosition: BacktestOpenPosition | undefined;
}): ReactNode {
  if (trades.length === 0 && !openPosition) {
    return (
      <Text size="2" color="gray">
        No trades yet.
      </Text>
    );
  }
  return (
    <Table.Root size="1" aria-label="Trades">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>Entry</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Exit</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Buy</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Sell</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>P/L</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>ROI %</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Reason</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {trades.map((trade) => (
          <Table.Row key={`${trade.entryTs}-${trade.exitTs}`}>
            <Table.Cell>{formatTimestamp(trade.entryTs)}</Table.Cell>
            <Table.Cell>{formatTimestamp(trade.exitTs)}</Table.Cell>
            <Table.Cell>{formatPrice(trade.entryPrice)}</Table.Cell>
            <Table.Cell>{formatPrice(trade.exitPrice)}</Table.Cell>
            <Table.Cell>{formatChange(trade.pnl)}</Table.Cell>
            <Table.Cell>{formatPercent(trade.roiPct)}</Table.Cell>
            <Table.Cell>{exitReasonLabel(trade.exitReason)}</Table.Cell>
          </Table.Row>
        ))}
        {openPosition ? (
          <Table.Row>
            <Table.Cell>{formatTimestamp(openPosition.entryTs)}</Table.Cell>
            <Table.Cell>{EMPTY_CELL}</Table.Cell>
            <Table.Cell>{formatPrice(openPosition.entryPrice)}</Table.Cell>
            <Table.Cell>{EMPTY_CELL}</Table.Cell>
            <Table.Cell>
              <Flex align="center" gap="2">
                {formatChange(openPosition.unrealizedPnl)}
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
  );
}

/**
 * The Daily P&L tab: the per-exit-day histogram above the five-item summary
 * block (number of trades, winners/losers, average ROI per trade, total P/L,
 * average days in trade).
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
      <Flex direction="column" gap="2" aria-label="Daily P&L summary">
        <Metric label="Trades" value={String(summary.tradeCount)} />
        <Metric label="Winners / losers" value={`${summary.winners} / ${summary.losers}`} />
        <Metric label="Avg ROI per trade" value={formatPercent(summary.avgRoiPct)} />
        <Metric label="Total P/L" value={formatChange(summary.totalPnl)} />
        <Metric label="Avg days in trade" value={summary.avgDaysInTrade.toFixed(2)} />
      </Flex>
    </Flex>
  );
}

/** One label/value row in the Summary and Daily P&L blocks. */
function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <Flex justify="between" align="center" gap="4">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Text size="2" weight="medium">
        {value}
      </Text>
    </Flex>
  );
}
