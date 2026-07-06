// @vitest-environment jsdom
import {
  BacktestExitReason,
  type BacktestOpenPosition,
  type BacktestSummary,
  type BacktestTrade,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyPnlBar } from './daily-pnl.js';
import { ResultsTabs } from './results-tabs.js';

// The histogram loads lightweight-charts, which doesn't run under jsdom; render
// it as a double that exposes the bucketed bar count so exit-day bucketing is
// observable without the real canvas.
vi.mock('./daily-pnl-chart.js', () => ({
  DailyPnlChart: ({ bars }: { bars: readonly DailyPnlBar[] }) => (
    <div data-testid="daily-pnl-chart">{bars.length} bars</div>
  ),
}));

/** `2021-01-01T00:00:00Z` — a UTC-midnight anchor for exit-day bucketing. */
const DAY_0 = Date.UTC(2021, 0, 1);
/** `2021-01-02T00:00:00Z` — the next UTC day. */
const DAY_1 = Date.UTC(2021, 0, 2);

const TRADES: BacktestTrade[] = [
  {
    entryTs: DAY_0 + 1_000,
    exitTs: DAY_0 + 3_600_000,
    entryPrice: 100,
    exitPrice: 110,
    quantity: 2,
    commission: 1,
    pnl: 19,
    roiPct: 9.5,
    exitReason: BacktestExitReason.ProfitTarget,
  },
  {
    entryTs: DAY_1 + 1_000,
    exitTs: DAY_1 + 3_600_000,
    entryPrice: 110,
    exitPrice: 105,
    quantity: 2,
    commission: 1,
    pnl: -11,
    roiPct: -5,
    exitReason: BacktestExitReason.StopLoss,
  },
];

const OPEN_POSITION: BacktestOpenPosition = {
  entryTs: DAY_1 + 7_200_000,
  entryPrice: 105,
  quantity: 1,
  entryCommission: 1,
  unrealizedPnl: 4,
};

const SUMMARY: BacktestSummary = {
  totalPnl: 8,
  roiPct: 0.08,
  avgPnlPerTrade: 4,
  tradeCount: 2,
  winners: 1,
  losers: 1,
  avgRoiPct: 2.25,
  avgDaysInTrade: 0.5,
};

function renderTabs(props: {
  trades: readonly BacktestTrade[];
  summary: BacktestSummary;
  openPosition: BacktestOpenPosition | undefined;
}): void {
  render(
    <Theme>
      <ResultsTabs {...props} />
    </Theme>,
  );
}

describe('ResultsTabs', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the Summary realized aggregates plus the open-position unrealized line', () => {
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: OPEN_POSITION });

    const summary = screen.getByLabelText('Summary');
    expect({
      totalPnl: within(summary).getByText('Total P/L').nextElementSibling?.textContent,
      roiPct: within(summary).getByText('ROI %').nextElementSibling?.textContent,
      avgPnl: within(summary).getByText('Avg P/L per trade').nextElementSibling?.textContent,
      unrealized: within(summary).getByText('Open position (unrealized)').nextElementSibling
        ?.textContent,
    }).toEqual({
      totalPnl: '+8.00',
      roiPct: '+0.08%',
      avgPnl: '+4.00',
      unrealized: '+4.00',
    });
  });

  it('omits the open-position line from Summary when no position is open', () => {
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });

    expect(screen.queryByText('Open position (unrealized)')).toBeNull();
  });

  it('renders closed trades with exit reasons and the open position as an unrealized final row', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: OPEN_POSITION });
    await user.click(screen.getByRole('tab', { name: /Trades/ }));

    const rows = within(screen.getByLabelText('Trades')).getAllByRole('row');
    expect({
      closedReasons: [
        within(rows[1] as HTMLElement).getByText('Profit target').textContent,
        within(rows[2] as HTMLElement).getByText('Stop loss').textContent,
      ],
      openReason: within(rows[3] as HTMLElement).getByText('Open').textContent,
      openUnrealized: within(rows[3] as HTMLElement).getByText('unrealized').textContent,
      openPnl: within(rows[3] as HTMLElement).getByText('+4.00') !== null,
    }).toEqual({
      closedReasons: ['Profit target', 'Stop loss'],
      openReason: 'Open',
      openUnrealized: 'unrealized',
      openPnl: true,
    });
  });

  it('renders the Daily P&L histogram bucketed by exit day plus the five-item summary block', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: OPEN_POSITION });
    await user.click(screen.getByRole('tab', { name: /Daily P&L/ }));

    const block = screen.getByLabelText('Daily P&L summary');
    expect({
      bars: screen.getByTestId('daily-pnl-chart').textContent,
      trades: within(block).getByText('Trades').nextElementSibling?.textContent,
      winnersLosers: within(block).getByText('Winners / losers').nextElementSibling?.textContent,
      avgRoi: within(block).getByText('Avg ROI per trade').nextElementSibling?.textContent,
      totalPnl: within(block).getByText('Total P/L').nextElementSibling?.textContent,
      avgDays: within(block).getByText('Avg days in trade').nextElementSibling?.textContent,
    }).toEqual({
      bars: '2 bars',
      trades: '2',
      winnersLosers: '1 / 1',
      avgRoi: '+2.25%',
      totalPnl: '+8.00',
      avgDays: '0.50',
    });
  });
});
