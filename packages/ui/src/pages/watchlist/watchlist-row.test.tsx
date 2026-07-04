// @vitest-environment jsdom
import { type EnrichedSymbol, Period, type SymbolQuoteEvent, SymbolType } from '@lametrader/core';
import { Table, Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchlistRow } from './watchlist-row.js';

/** A controllable fake `WebSocket` for the shared stream client. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  private readonly listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor() {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (event: unknown) => void): void {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  send(): void {}
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    for (const cb of this.listeners.close ?? []) cb({});
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const cb of this.listeners.open ?? []) cb({});
  }
  emit(frame: unknown): void {
    for (const cb of this.listeners.message ?? []) cb({ data: JSON.stringify(frame) });
  }
}

const BTC: EnrichedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
  quote: { price: 100, change: 1, changePct: 0.01, period: Period.OneDay, time: 1000 },
};

/** The live frame that should overwrite the snapshot values in place. */
const liveFrame: SymbolQuoteEvent = {
  subscriptionId: 'sub-1',
  id: BTC.id,
  period: Period.OneDay,
  quote: { price: 200, change: 5, changePct: 0.05, time: 2000 },
  final: false,
};

describe('WatchlistRow live quotes', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderRow(): void {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Theme>
            <Table.Root>
              <Table.Body>
                <WatchlistRow symbol={BTC} availablePeriods={[Period.OneHour]} />
              </Table.Body>
            </Table.Root>
          </Theme>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('updates its price cells when a live quote arrives over the stream', () => {
    renderRow();
    const snapshot = screen.getByText('100.00').textContent;
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.emit({
        action: 'subscribed-quote',
        subscriptionId: 'sub-1',
        id: BTC.id,
        period: Period.OneDay,
      });
      socket?.emit(liveFrame);
    });

    expect({
      snapshot,
      price: screen.getByText('200.00').textContent,
      change: screen.getByText('+5.00').textContent,
      changePct: screen.getByText('+5.00%').textContent,
    }).toEqual({ snapshot: '100.00', price: '200.00', change: '+5.00', changePct: '+5.00%' });
  });
});
