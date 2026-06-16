// @vitest-environment jsdom
import { Period } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackfillJobStatus } from '../../lib/backfill.types';
import { BackfillDialog } from './backfill-dialog';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { toast } from 'sonner';

/**
 * A controllable fake WebSocket. The per-job WS client opens `new WebSocket`,
 * so stubbing the global lets a test push job frames and assert the modal's
 * live progress without real sockets (jsdom has none).
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = 1;
  private readonly listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (event: unknown) => void): void {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }

  removeEventListener(type: string, cb: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((fn) => fn !== cb);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
    for (const cb of this.listeners.close ?? []) cb({});
  }

  /** Test helper: deliver a JSON frame as a `message` event. */
  emit(frame: unknown): void {
    for (const cb of this.listeners.message ?? []) cb({ data: JSON.stringify(frame) });
  }
}

const BTC_ID = 'crypto:BTCUSDT';

/** A running job as the POST returns it (and the WS replays on connect). */
const runningJob = (jobId: string) => ({
  id: jobId,
  symbolId: BTC_ID,
  period: Period.OneHour,
  status: BackfillJobStatus.Running,
  progress: null,
  summary: null,
  error: null,
});

describe('BackfillDialog', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;
  let matchers: Array<{ method: string; includes: string; body: () => unknown; status: number }>;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    matchers = [];
    fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const match = matchers.find((m) => m.method === method && String(url).includes(m.includes));
      if (!match) throw new Error(`unexpected fetch: ${method} ${url}`);
      return new Response(match.status === 204 ? null : JSON.stringify(match.body()), {
        status: match.status,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function onRequest(method: string, includes: string, body: () => unknown, status = 200): void {
    matchers.push({ method, includes, body, status });
  }

  function renderDialog(periods: Period[]): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <BackfillDialog
            id={BTC_ID}
            periods={periods}
            open={true}
            onOpenChange={() => undefined}
          />
        </Theme>
      </QueryClientProvider>,
    );
  }

  /** The single open WebSocket, once the modal has started a job. */
  async function latestSocket(): Promise<FakeWebSocket> {
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1] as FakeWebSocket;
  }

  it('starts a backfill and shows a live progress bar resolving to a success summary', async () => {
    onRequest('POST', '/symbols/crypto:BTCUSDT/backfill', () => runningJob('job-1'), 202);
    renderDialog([Period.OneHour]);
    const user = userEvent.setup();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Start backfill' }));
    });

    const socket = await latestSocket();
    act(() => socket.emit({ ...runningJob('job-1'), progress: { saved: 1, total: 3 } }));
    await screen.findByRole('progressbar');
    act(() =>
      socket.emit({
        ...runningJob('job-1'),
        status: BackfillJobStatus.Succeeded,
        progress: { saved: 3, total: 3 },
        summary: {
          id: BTC_ID,
          period: Period.OneHour,
          from: 1000,
          to: 3000,
          fetched: 3,
          saved: 3,
          complete: true,
        },
      }),
    );

    await screen.findByText('Saved 3 candles');
    const postCall = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect({
      url: postCall?.[0],
      body: (postCall?.[1] as RequestInit | undefined)?.body,
      toasted: (toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    }).toEqual({
      url: '/api/symbols/crypto:BTCUSDT/backfill',
      body: JSON.stringify({ period: '1h' }),
      toasted: 'Backfilled 1h for crypto:BTCUSDT',
    });
  });

  it('shows the error of a failed job and retries it with a fresh POST', async () => {
    let started = 0;
    onRequest(
      'POST',
      '/symbols/crypto:BTCUSDT/backfill',
      () => {
        started += 1;
        return runningJob(started === 1 ? 'job-1' : 'job-2');
      },
      202,
    );
    renderDialog([Period.OneHour]);
    const user = userEvent.setup();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Start backfill' }));
    });
    const firstSocket = await latestSocket();
    act(() =>
      firstSocket.emit({
        ...runningJob('job-1'),
        status: BackfillJobStatus.Failed,
        progress: { saved: 1, total: 3 },
        error: 'Binance failed to fetch candles for crypto:BTCUSDT: 418',
      }),
    );

    await screen.findByText('Binance failed to fetch candles for crypto:BTCUSDT: 418');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Retry' }));
    });

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
    const secondSocket = FakeWebSocket.instances[1] as FakeWebSocket;
    act(() =>
      secondSocket.emit({
        ...runningJob('job-2'),
        status: BackfillJobStatus.Succeeded,
        progress: { saved: 3, total: 3 },
        summary: {
          id: BTC_ID,
          period: Period.OneHour,
          from: 1000,
          to: 3000,
          fetched: 3,
          saved: 3,
          complete: true,
        },
      }),
    );

    await screen.findByText('Saved 3 candles');
    expect(
      fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
        .length,
    ).toEqual(2);
  });

  it('surfaces a 409 (already running) inline with a retry, not a crash', async () => {
    onRequest(
      'POST',
      '/symbols/crypto:BTCUSDT/backfill',
      () => ({ error: 'a backfill is already running for crypto:BTCUSDT 1h' }),
      409,
    );
    renderDialog([Period.OneHour]);
    const user = userEvent.setup();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Start backfill' }));
    });

    await screen.findByText('a backfill is already running for crypto:BTCUSDT 1h');
    expect({
      hasRetry: screen.getByRole('button', { name: 'Retry' }) !== null,
      sockets: FakeWebSocket.instances.length,
    }).toEqual({ hasRetry: true, sockets: 0 });
  });

  it('passes an explicit from/to range through as epoch-ms in the POST body', async () => {
    onRequest('POST', '/symbols/crypto:BTCUSDT/backfill', () => runningJob('job-1'), 202);
    renderDialog([Period.OneHour]);
    const user = userEvent.setup();

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2024-01-31' } });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Start backfill' }));
    });

    await latestSocket();
    const postCall = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect((postCall?.[1] as RequestInit | undefined)?.body).toEqual(
      JSON.stringify({
        period: '1h',
        from: new Date('2024-01-01').getTime(),
        to: new Date('2024-01-31').getTime(),
      }),
    );
  });
});
