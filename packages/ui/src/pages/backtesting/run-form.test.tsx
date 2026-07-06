// @vitest-environment jsdom
import { type Backtest, BacktestStatus, Period } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunForm } from './run-form.js';

const RUNNING: Backtest = {
  id: 'b-1',
  name: 'run',
  status: BacktestStatus.Running,
  createdAt: 1,
  updatedAt: 1,
  params: {
    symbolId: 'crypto:BTCUSDT',
    profileId: 'p-1',
    profileName: 'Alpha',
    period: Period.OneHour,
    start: 1_000,
    end: 2_000,
    initialCapital: 10_000,
    commission: {},
  },
  strategyId: 's-1',
  strategy: {
    id: 's-1',
    name: 'S',
    description: '',
    entry: { signal: { key: 'go_long', value: { type: 'bool', value: true } } },
    exit: { profitTarget: { kind: 'fixed', amount: 5 } },
    createdAt: 1,
    updatedAt: 1,
  } as Backtest['strategy'],
  trades: [],
  summary: {
    totalPnl: 0,
    roiPct: 0,
    avgPnlPerTrade: 0,
    tradeCount: 0,
    winners: 0,
    losers: 0,
    avgRoiPct: 0,
    avgDaysInTrade: 0,
  },
};

describe('RunForm', () => {
  let queryClient: QueryClient;
  let posted: unknown[];
  let respond: () => Response;

  beforeEach(() => {
    posted = [];
    respond = () =>
      new Response(JSON.stringify(RUNNING), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      posted.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
      return respond();
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderForm(props: Partial<Parameters<typeof RunForm>[0]> = {}): {
    onStarted: ReturnType<typeof vi.fn>;
  } {
    const onStarted = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <RunForm
            strategyId="s-1"
            symbolId="crypto:BTCUSDT"
            profileId="p-1"
            period={Period.OneHour}
            onStarted={onStarted}
            {...props}
          />
        </Theme>
      </QueryClientProvider>,
    );
    return { onStarted };
  }

  it('renders the capital, date, and commission fields plus the Run button', () => {
    renderForm();

    expect({
      capital: screen.getByLabelText('Initial capital') !== null,
      start: screen.getByLabelText('Start') !== null,
      end: screen.getByLabelText('End') !== null,
      rate: screen.getByLabelText('Commission rate') !== null,
      fixed: screen.getByLabelText('Fixed commission') !== null,
      run: screen.getByRole('button', { name: 'Run backtest' }) !== null,
    }).toEqual({ capital: true, start: true, end: true, rate: true, fixed: true, run: true });
  });

  it('rejects a non-positive initial capital client-side without posting', async () => {
    const user = userEvent.setup();
    renderForm();

    const capital = screen.getByLabelText('Initial capital');
    await user.clear(capital);
    await user.type(capital, '0');
    await user.click(screen.getByRole('button', { name: 'Run backtest' }));

    expect(await screen.findByText('Initial capital must be greater than 0.')).toBeInTheDocument();
    expect(posted).toEqual([]);
  });

  it('rejects a start on or after the end client-side without posting', async () => {
    const user = userEvent.setup();
    renderForm();

    const start = screen.getByLabelText('Start');
    const end = screen.getByLabelText('End');
    await user.clear(start);
    await user.type(start, '2024-02-01');
    await user.clear(end);
    await user.type(end, '2024-01-01');
    await user.click(screen.getByRole('button', { name: 'Run backtest' }));

    expect(await screen.findByText('Start must be before end.')).toBeInTheDocument();
    expect(posted).toEqual([]);
  });

  it('disables Run and hints when no strategy is selected', () => {
    renderForm({ strategyId: null });

    expect({
      disabled: screen.getByRole('button', { name: 'Run backtest' }).hasAttribute('disabled'),
      hint: screen.getByText('Select a strategy and a profile to run.') !== null,
    }).toEqual({ disabled: true, hint: true });
  });

  it('posts the run and reports the new run id on a valid submit', async () => {
    const user = userEvent.setup();
    const { onStarted } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Run backtest' }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('b-1'));
    expect(posted).toEqual([
      {
        strategyId: 's-1',
        symbolId: 'crypto:BTCUSDT',
        profileId: 'p-1',
        period: Period.OneHour,
        start: expect.any(Number),
        end: expect.any(Number),
        initialCapital: 10_000,
        commission: {},
      },
    ]);
  });

  it('surfaces a server 409 conflict as a form-level error', async () => {
    const user = userEvent.setup();
    respond = () =>
      new Response(JSON.stringify({ error: 'A backtest is already running.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    const { onStarted } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Run backtest' }));

    expect(await screen.findByText('A backtest is already running.')).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
