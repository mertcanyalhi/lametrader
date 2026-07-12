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
import type { PnlPoint } from './pnl-series.js';
import { ResultsTabs } from './results-tabs.js';

// Both charts load lightweight-charts, which doesn't run under jsdom; render
// them as doubles. The histogram exposes its bar count; the baseline chart (used
// for both the equity curve and the per-trade series) exposes its point values so
// tests can tell the two series apart without the real canvas.
vi.mock('./daily-pnl-chart.js', () => ({
  DailyPnlChart: ({ bars }: { bars: readonly DailyPnlBar[] }) => (
    <div data-testid="daily-pnl-chart">{bars.length} bars</div>
  ),
}));
vi.mock('./pnl-baseline-chart.js', () => ({
  PnlBaselineChart: ({ points }: { points: readonly PnlPoint[] }) => (
    <div data-testid="pnl-baseline-chart">{points.map((point) => point.value).join(',')}</div>
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

/** A losing run — every signed metric flips negative for the red-accent tests. */
const SUMMARY_NEG: BacktestSummary = {
  totalPnl: -8,
  roiPct: -0.08,
  avgPnlPerTrade: -4,
  tradeCount: 2,
  winners: 1,
  losers: 1,
  avgRoiPct: -2.25,
  avgDaysInTrade: 0.5,
};

/** A break-even run — Total P/L is exactly zero for the neutral-accent test. */
const SUMMARY_ZERO: BacktestSummary = { ...SUMMARY, totalPnl: 0 };

/** Twelve closed winners spanning distinct exit days — enough to overflow one page. */
const MANY_TRADES: BacktestTrade[] = Array.from({ length: 12 }, (_, i) => ({
  entryTs: DAY_0 + i * 3_600_000,
  exitTs: DAY_0 + i * 3_600_000 + 60_000,
  entryPrice: 100,
  exitPrice: 110,
  quantity: 1,
  commission: 1,
  pnl: i + 1,
  roiPct: 1,
  exitReason: BacktestExitReason.ProfitTarget,
}));

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
      totalPnl: within(summary).getByText('Total P/L').previousElementSibling?.textContent,
      roiPct: within(summary).getByText('ROI %').previousElementSibling?.textContent,
      avgPnl: within(summary).getByText('Avg P/L per trade').previousElementSibling?.textContent,
      unrealized: within(summary).getByText('Open position (unrealized)').previousElementSibling
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

  it('renders the open position as an unrealized first row above the closed trades', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: OPEN_POSITION });
    await user.click(screen.getByRole('tab', { name: /Trades/ }));

    const rows = within(screen.getByLabelText('Trades')).getAllByRole('row');
    expect({
      openReason: within(rows[1] as HTMLElement).getByText('Open').textContent,
      openUnrealized: within(rows[1] as HTMLElement).getByText('unrealized').textContent,
      openPnl: within(rows[1] as HTMLElement).getByText('+4.00') !== null,
      closedReasons: [
        within(rows[2] as HTMLElement).getByText('Stop loss').textContent,
        within(rows[3] as HTMLElement).getByText('Profit target').textContent,
      ],
    }).toEqual({
      openReason: 'Open',
      openUnrealized: 'unrealized',
      openPnl: true,
      closedReasons: ['Stop loss', 'Profit target'],
    });
  });

  it('renders trade entry and exit timestamps as date plus HH:mm to the minute', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });
    await user.click(screen.getByRole('tab', { name: /Trades/ }));

    const rows = within(screen.getByLabelText('Trades')).getAllByRole('row');
    const newest = rows[1] as HTMLElement;
    expect({
      entry: within(newest).getByText('2021-01-02 00:00').textContent,
      exit: within(newest).getByText('2021-01-02 01:00').textContent,
    }).toEqual({ entry: '2021-01-02 00:00', exit: '2021-01-02 01:00' });
  });

  it('renders a Duration column showing each closed trade holding span', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });
    await user.click(screen.getByRole('tab', { name: /Trades/ }));

    const rows = within(screen.getByLabelText('Trades')).getAllByRole('row');
    // Each trade spans DAY+1s → DAY+1h, i.e. 59m59s; sub-minute noise is dropped.
    expect({
      header: within(rows[0] as HTMLElement).getByText('Duration').textContent,
      firstDuration: within(rows[1] as HTMLElement).getByText('59m').textContent,
    }).toEqual({ header: 'Duration', firstDuration: '59m' });
  });

  it('renders the full merged metric block under Summary, including counts and averages', async () => {
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });

    const block = screen.getByLabelText('Summary');
    expect({
      trades: within(block).getByText('Trades').previousElementSibling?.textContent,
      winnersLosers:
        within(block).getByText('Winners / losers').previousElementSibling?.textContent,
      avgRoi: within(block).getByText('Avg ROI per trade').previousElementSibling?.textContent,
      avgPnl: within(block).getByText('Avg P/L per trade').previousElementSibling?.textContent,
      avgPeriod: within(block).getByText('Avg period in trade').previousElementSibling?.textContent,
    }).toEqual({
      trades: '2',
      winnersLosers: '1 / 1',
      avgRoi: '+2.25%',
      avgPnl: '+4.00',
      avgPeriod: '12h',
    });
  });

  it('renders the win rate as winners over trade count under Summary', () => {
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });

    const block = screen.getByLabelText('Summary');
    // 1 winner of 2 trades → 50.0%.
    expect(within(block).getByText('Win rate').previousElementSibling?.textContent).toEqual(
      '50.0%',
    );
  });

  it('colors a mid-range win rate (50%) with the yellow band', () => {
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });

    const value = within(screen.getByLabelText('Summary')).getByText(
      'Win rate',
    ).previousElementSibling;
    expect(value?.getAttribute('data-accent-color')).toEqual('yellow');
  });

  it('colors a top win rate (100%) with the green band', () => {
    renderTabs({
      trades: TRADES,
      summary: { ...SUMMARY, winners: 2, losers: 0 },
      openPosition: undefined,
    });

    const value = within(screen.getByLabelText('Summary')).getByText(
      'Win rate',
    ).previousElementSibling;
    expect(value?.getAttribute('data-accent-color')).toEqual('green');
  });

  it('shows the Daily P&L histogram under Summary by default', () => {
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });

    // TRADES exit on two distinct UTC days → two histogram bars.
    expect({
      daily: screen.getByTestId('daily-pnl-chart').textContent,
      baselineShown: screen.queryByTestId('pnl-baseline-chart'),
    }).toEqual({ daily: '2 bars', baselineShown: null });
  });

  it('switches the Summary chart to the cumulative equity curve when its segment is selected', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });

    await user.click(screen.getByRole('radio', { name: 'Equity curve' }));

    // Running totals: +19 after the first trade, +8 after the −11 second.
    expect({
      equity: screen.getByTestId('pnl-baseline-chart').textContent,
      dailyShown: screen.queryByTestId('daily-pnl-chart'),
    }).toEqual({ equity: '19,8', dailyShown: null });
  });

  it('switches the Summary chart to the per-trade win/lose series when its segment is selected', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });

    await user.click(screen.getByRole('radio', { name: 'Win/lose per trade' }));

    // Each trade's own P/L, not a running total: +19 then −11.
    expect({
      perTrade: screen.getByTestId('pnl-baseline-chart').textContent,
      dailyShown: screen.queryByTestId('daily-pnl-chart'),
    }).toEqual({ perTrade: '19,-11', dailyShown: null });
  });

  it('colors a positive Summary metric value with the green accent', () => {
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });

    const value = screen.getByText('Total P/L').previousElementSibling;
    expect(value?.getAttribute('data-accent-color')).toEqual('grass');
  });

  it('colors a negative Summary metric value with the red accent', () => {
    renderTabs({ trades: TRADES, summary: SUMMARY_NEG, openPosition: undefined });

    const value = screen.getByText('Total P/L').previousElementSibling;
    expect(value?.getAttribute('data-accent-color')).toEqual('red');
  });

  it('colors a zero Summary metric value with the neutral gray accent', () => {
    renderTabs({ trades: TRADES, summary: SUMMARY_ZERO, openPosition: undefined });

    const value = screen.getByText('Total P/L').previousElementSibling;
    expect(value?.getAttribute('data-accent-color')).toEqual('gray');
  });

  it('colors a winning trade row P/L amount and ROI percentage with the green accent', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });
    await user.click(screen.getByRole('tab', { name: /Trades/ }));

    const rows = within(screen.getByLabelText('Trades')).getAllByRole('row');
    const winner = rows[2] as HTMLElement;
    expect({
      pnlText: within(winner).getByText('+19.00').textContent,
      pnlAccent: within(winner).getByText('+19.00').getAttribute('data-accent-color'),
      roiText: within(winner).getByText('+9.50%').textContent,
      roiAccent: within(winner).getByText('+9.50%').getAttribute('data-accent-color'),
    }).toEqual({
      pnlText: '+19.00',
      pnlAccent: 'grass',
      roiText: '+9.50%',
      roiAccent: 'grass',
    });
  });

  it('sorts the trades table by Entry descending by default, newest trade first', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });
    await user.click(screen.getByRole('tab', { name: /Trades/ }));

    const rows = within(screen.getByLabelText('Trades')).getAllByRole('row');
    expect({
      firstReason: within(rows[1] as HTMLElement).getByText('Stop loss').textContent,
      secondReason: within(rows[2] as HTMLElement).getByText('Profit target').textContent,
    }).toEqual({ firstReason: 'Stop loss', secondReason: 'Profit target' });
  });

  it('sorts the trades table by P/L ascending then descending when the P/L header is clicked', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: TRADES, summary: SUMMARY, openPosition: undefined });
    await user.click(screen.getByRole('tab', { name: /Trades/ }));

    await user.click(screen.getByRole('button', { name: 'P/L' }));
    const ascFirst = (within(screen.getByLabelText('Trades')).getAllByRole('row')[1] as HTMLElement)
      .textContent;
    await user.click(screen.getByRole('button', { name: 'P/L' }));
    const descFirst = (
      within(screen.getByLabelText('Trades')).getAllByRole('row')[1] as HTMLElement
    ).textContent;

    expect({
      ascFirstHasStopLoss: ascFirst?.includes('Stop loss'),
      descFirstHasProfitTarget: descFirst?.includes('Profit target'),
    }).toEqual({ ascFirstHasStopLoss: true, descFirstHasProfitTarget: true });
  });

  it('paginates the trades table, advancing to the remaining trades on Next', async () => {
    const user = userEvent.setup();
    renderTabs({ trades: MANY_TRADES, summary: SUMMARY, openPosition: undefined });
    await user.click(screen.getByRole('tab', { name: /Trades/ }));

    const firstPageRows = within(screen.getByLabelText('Trades')).getAllByRole('row').length;
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const secondPageRows = within(screen.getByLabelText('Trades')).getAllByRole('row').length;

    expect({ firstPageRows, secondPageRows }).toEqual({ firstPageRows: 11, secondPageRows: 3 });
  });
});
