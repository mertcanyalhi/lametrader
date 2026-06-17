// @vitest-environment jsdom
import { Period, type SymbolQuoteEvent } from '@lametrader/core';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuoteStream } from './use-quote-stream.js';

/**
 * A controllable fake `WebSocket` (the shared client opens `new WebSocket`).
 * Tracks the control frames sent and lets the test drive open/message events.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  readonly sent: unknown[] = [];
  private readonly listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor() {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (event: unknown) => void): void {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
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

const ID = 'crypto:BTCUSDT';
const OTHER = 'crypto:ETHUSDT';

/** A live quote frame for an id on a given subscription. */
const quoteFrame = (subscriptionId: string, id: string): SymbolQuoteEvent => ({
  subscriptionId,
  id,
  period: Period.OneDay,
  quote: { price: 101, change: 1, changePct: 0.01, time: 1000 },
  final: false,
});

describe('useQuoteStream', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('returns null before any frame and the latest quote once one arrives', () => {
    const { result } = renderHook(() => useQuoteStream(ID));
    const before = result.current;
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.emit({
        action: 'subscribed-quote',
        subscriptionId: 'sub-1',
        id: ID,
        period: Period.OneDay,
      });
      socket?.emit(quoteFrame('sub-1', ID));
    });

    expect({ before, after: result.current }).toEqual({
      before: null,
      after: { price: 101, change: 1, changePct: 0.01, time: 1000 },
    });
  });

  it('unsubscribes the old id and subscribes the new one when id changes', () => {
    const { rerender } = renderHook(({ id }) => useQuoteStream(id), { initialProps: { id: ID } });
    const first = FakeWebSocket.instances[0];
    act(() => {
      first?.open();
      first?.emit({
        action: 'subscribed-quote',
        subscriptionId: 'sub-1',
        id: ID,
        period: Period.OneDay,
      });
    });
    // Changing id releases the sole subscription (closing the idle socket) and
    // opens a fresh one for the new id; open it so its replayed subscribe lands.
    act(() => rerender({ id: OTHER }));
    act(() => FakeWebSocket.instances[1]?.open());

    expect(FakeWebSocket.instances.flatMap((socket) => socket.sent)).toEqual([
      { action: 'subscribe-quote', id: ID },
      { action: 'unsubscribe-quote', subscriptionId: 'sub-1' },
      { action: 'subscribe-quote', id: OTHER },
    ]);
  });
});
