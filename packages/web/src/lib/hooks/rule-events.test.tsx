// @vitest-environment jsdom
import { type RuleEventEntry, RuleEventType, StateScope, StateValueType } from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKER_PAGE_SIZE, useRuleEventStream } from './rule-events.js';
import { symbolRuleEventsKey } from './rules.js';

const ID = 'crypto:BTCUSDT';
const OTHER = 'crypto:ETHUSDT';

/** Build a `StateSet` entry at `ts`. */
function entry(ts: number, key = 'streak', value = 1): RuleEventEntry {
  return {
    type: RuleEventType.StateSet,
    ts,
    firedAt: ts + 1,
    ruleId: 'r-1',
    symbolId: ID,
    scope: StateScope.Symbol,
    key,
    value: { type: StateValueType.Number, value },
  };
}

/** A controllable fake `WebSocket` for the shared stream client. */
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

describe('useRuleEventStream', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function wrapper(): (props: { children: ReactNode }) => ReactNode {
    return ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  it('sends a subscribe-rule-event frame for the symbol on mount', () => {
    renderHook(() => useRuleEventStream(ID), { wrapper: wrapper() });
    act(() => FakeWebSocket.instances[0]?.open());

    expect(FakeWebSocket.instances.flatMap((socket) => socket.sent)).toEqual([
      { action: 'subscribe-rule-event', id: ID },
    ]);
  });

  it('prepends a streamed entry into the markers query cache when a frame arrives for the watched id', () => {
    const existing = entry(1_700_000_000_000);
    queryClient.setQueryData([...symbolRuleEventsKey(ID), 'markers'], [existing]);
    renderHook(() => useRuleEventStream(ID), { wrapper: wrapper() });
    const incoming = entry(1_700_000_100_000, 'streak', 2);
    act(() => {
      FakeWebSocket.instances[0]?.open();
      FakeWebSocket.instances[0]?.emit({ symbolId: ID, entry: incoming });
    });

    expect(queryClient.getQueryData([...symbolRuleEventsKey(ID), 'markers'])).toEqual([
      incoming,
      existing,
    ]);
  });

  it('truncates the markers cache to MARKER_PAGE_SIZE after a prepend that would overflow', () => {
    const seed: RuleEventEntry[] = Array.from({ length: MARKER_PAGE_SIZE }, (_, i) =>
      entry(1_700_000_000_000 + i),
    );
    queryClient.setQueryData([...symbolRuleEventsKey(ID), 'markers'], seed);
    renderHook(() => useRuleEventStream(ID), { wrapper: wrapper() });
    const incoming = entry(1_700_001_000_000, 'streak', 99);
    act(() => {
      FakeWebSocket.instances[0]?.open();
      FakeWebSocket.instances[0]?.emit({ symbolId: ID, entry: incoming });
    });

    const cached = queryClient.getQueryData<RuleEventEntry[]>([
      ...symbolRuleEventsKey(ID),
      'markers',
    ]);
    expect({ length: cached?.length, head: cached?.[0], last: cached?.at(-1) }).toEqual({
      length: MARKER_PAGE_SIZE,
      head: incoming,
      last: seed[MARKER_PAGE_SIZE - 2],
    });
  });

  it('invalidates the events-dialog infinite query under the same symbol when a frame arrives', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useRuleEventStream(ID), { wrapper: wrapper() });
    act(() => {
      FakeWebSocket.instances[0]?.open();
      FakeWebSocket.instances[0]?.emit({ symbolId: ID, entry: entry(1_700_000_100_000) });
    });

    expect(invalidateSpy.mock.calls).toEqual([
      [{ queryKey: [...symbolRuleEventsKey(ID), 'infinite'] }],
    ]);
  });

  it('sends an unsubscribe-rule-event frame on unmount', () => {
    const { unmount } = renderHook(() => useRuleEventStream(ID), { wrapper: wrapper() });
    act(() => FakeWebSocket.instances[0]?.open());
    act(() => unmount());

    expect(FakeWebSocket.instances.flatMap((socket) => socket.sent)).toEqual([
      { action: 'subscribe-rule-event', id: ID },
      { action: 'unsubscribe-rule-event', id: ID },
    ]);
  });

  it('swaps the upstream subscription when the symbol id changes', () => {
    const { rerender } = renderHook(({ id }) => useRuleEventStream(id), {
      initialProps: { id: ID },
      wrapper: wrapper(),
    });
    act(() => FakeWebSocket.instances[0]?.open());
    act(() => rerender({ id: OTHER }));
    act(() => FakeWebSocket.instances[1]?.open());

    expect(FakeWebSocket.instances.flatMap((socket) => socket.sent)).toEqual([
      { action: 'subscribe-rule-event', id: ID },
      { action: 'unsubscribe-rule-event', id: ID },
      { action: 'subscribe-rule-event', id: OTHER },
    ]);
  });
});
