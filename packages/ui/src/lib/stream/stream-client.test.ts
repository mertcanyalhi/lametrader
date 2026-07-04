// @vitest-environment jsdom
import {
  type Candle,
  EvaluationTriggerKind,
  type IndicatorStateEvent,
  Period,
  PriceSource,
  type RuleEventEntry,
  RuleEventType,
  type SymbolQuoteEvent,
  SymbolType,
} from '@lametrader/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamClient } from './stream-client.js';
import { type CandleEvent, StreamKind } from './stream-client.types.js';

/**
 * A controllable fake `WebSocket`. The stream client opens `new WebSocket`, so
 * stubbing the global lets a test drive the connection lifecycle (open / message
 * / close) and capture the control frames the client sends — no real socket.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: unknown[] = [];
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

  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    for (const cb of this.listeners.close ?? []) cb({});
  }

  /** Test helper: transition to OPEN and fire the `open` event. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const cb of this.listeners.open ?? []) cb({});
  }

  /** Test helper: deliver a JSON frame as a `message` event. */
  emit(frame: unknown): void {
    for (const cb of this.listeners.message ?? []) cb({ data: JSON.stringify(frame) });
  }
}

const ID = 'crypto:BTCUSDT';

/** A live quote frame for `ID` on subscription `subscriptionId`. */
const quoteFrame = (subscriptionId: string): SymbolQuoteEvent => ({
  subscriptionId,
  id: ID,
  period: Period.OneDay,
  quote: { price: 101, change: 1, changePct: 0.01, time: 1000 },
  final: false,
});

/** A candle event frame for `ID`. */
const candle: Candle = {
  type: SymbolType.Crypto,
  time: 1000,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  quoteVolume: 15,
  trades: 3,
};
const candleEvent: CandleEvent = { id: ID, period: Period.OneHour, candle, final: false };

describe('createStreamClient', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens one shared socket and reuses it across subscriptions of different ids', () => {
    const client = createStreamClient();

    client.subscribe(StreamKind.Quote, 'crypto:AAA', () => {});
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    client.subscribe(StreamKind.Quote, 'crypto:BBB', () => {});

    expect({ instances: FakeWebSocket.instances.length, sent: socket?.sent }).toEqual({
      instances: 1,
      sent: [
        { action: 'subscribe-quote', id: 'crypto:AAA' },
        { action: 'subscribe-quote', id: 'crypto:BBB' },
      ],
    });
  });

  it('delivers a quote frame after the subscribed-quote reply and unsubscribes by server id', () => {
    const client = createStreamClient();
    const received: SymbolQuoteEvent[] = [];

    const unsubscribe = client.subscribe(StreamKind.Quote, ID, (event) => received.push(event));
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.emit({
      action: 'subscribed-quote',
      subscriptionId: 'sub-1',
      id: ID,
      period: Period.OneDay,
    });
    socket?.emit(quoteFrame('sub-1'));
    unsubscribe();

    expect({ received, lastSent: socket?.sent.at(-1) }).toEqual({
      received: [quoteFrame('sub-1')],
      lastSent: { action: 'unsubscribe-quote', subscriptionId: 'sub-1' },
    });
  });

  it('delivers candle frames matched by id and unsubscribes by id', () => {
    const client = createStreamClient();
    const received: CandleEvent[] = [];

    const unsubscribe = client.subscribe(StreamKind.Candle, ID, (event) => received.push(event));
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.emit(candleEvent);
    unsubscribe();

    expect({ received, sent: socket?.sent }).toEqual({
      received: [candleEvent],
      sent: [
        { action: 'subscribe', id: ID },
        { action: 'unsubscribe', id: ID },
      ],
    });
  });

  it('shares one upstream subscription across listeners and unsubscribes only when the last leaves', () => {
    const client = createStreamClient();

    const unsubscribeA = client.subscribe(StreamKind.Quote, ID, () => {});
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    const unsubscribeB = client.subscribe(StreamKind.Quote, ID, () => {});
    socket?.emit({
      action: 'subscribed-quote',
      subscriptionId: 'sub-1',
      id: ID,
      period: Period.OneDay,
    });
    unsubscribeA();
    const afterFirstRelease = [...(socket?.sent ?? [])];
    unsubscribeB();

    expect({ afterFirstRelease, finalSent: socket?.sent }).toEqual({
      afterFirstRelease: [{ action: 'subscribe-quote', id: ID }],
      finalSent: [
        { action: 'subscribe-quote', id: ID },
        { action: 'unsubscribe-quote', subscriptionId: 'sub-1' },
      ],
    });
  });

  it('subscribes an indicator with structured args and delivers state events keyed by server subscriptionId', () => {
    const client = createStreamClient();
    const received: IndicatorStateEvent[] = [];

    const unsubscribe = client.subscribe(
      StreamKind.Indicator,
      {
        id: ID,
        period: Period.OneHour,
        indicator: { key: 'sma', inputs: { length: 14, source: PriceSource.Close } },
      },
      (event) => received.push(event),
    );
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.emit({
      action: 'subscribed-indicator',
      subscriptionId: 'sub-ind-1',
      id: ID,
      period: Period.OneHour,
      indicatorKey: 'sma',
    });
    const event: IndicatorStateEvent = {
      subscriptionId: 'sub-ind-1',
      id: ID,
      period: Period.OneHour,
      indicatorKey: 'sma',
      state: { time: 1000, value: 105.5 },
      final: false,
    };
    socket?.emit(event);
    unsubscribe();

    expect({ received, lastSent: socket?.sent.at(-1), firstSent: socket?.sent[0] }).toEqual({
      received: [event],
      firstSent: {
        action: 'subscribe-indicator',
        id: ID,
        period: Period.OneHour,
        indicator: { key: 'sma', inputs: { length: 14, source: PriceSource.Close } },
      },
      lastSent: { action: 'unsubscribe-indicator', subscriptionId: 'sub-ind-1' },
    });
  });

  it('only sends unsubscribe-indicator once the server reply has bound a subscriptionId', () => {
    const client = createStreamClient();

    const unsubscribe = client.subscribe(
      StreamKind.Indicator,
      { id: ID, period: Period.OneHour, indicator: { key: 'sma', inputs: { length: 14 } } },
      () => {},
    );
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    // No subscribed-indicator reply yet — releasing must not send an unbound unsubscribe.
    unsubscribe();

    expect(socket?.sent).toEqual([
      {
        action: 'subscribe-indicator',
        id: ID,
        period: Period.OneHour,
        indicator: { key: 'sma', inputs: { length: 14 } },
      },
    ]);
  });

  it('shares one upstream indicator subscription across listeners on the same tuple', () => {
    const client = createStreamClient();
    const args = {
      id: ID,
      period: Period.OneHour,
      indicator: { key: 'sma', inputs: { length: 14 } },
    };

    const unsubscribeA = client.subscribe(StreamKind.Indicator, args, () => {});
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    const unsubscribeB = client.subscribe(StreamKind.Indicator, args, () => {});
    socket?.emit({
      action: 'subscribed-indicator',
      subscriptionId: 'sub-ind-1',
      id: ID,
      period: Period.OneHour,
      indicatorKey: 'sma',
    });
    unsubscribeA();
    const afterFirstRelease = [...(socket?.sent ?? [])];
    unsubscribeB();

    expect({ afterFirstRelease, finalSent: socket?.sent }).toEqual({
      afterFirstRelease: [
        {
          action: 'subscribe-indicator',
          id: ID,
          period: Period.OneHour,
          indicator: { key: 'sma', inputs: { length: 14 } },
        },
      ],
      finalSent: [
        {
          action: 'subscribe-indicator',
          id: ID,
          period: Period.OneHour,
          indicator: { key: 'sma', inputs: { length: 14 } },
        },
        { action: 'unsubscribe-indicator', subscriptionId: 'sub-ind-1' },
      ],
    });
  });

  it('replays each active indicator subscription on reconnect and re-binds the new subscriptionId so frames keep routing', () => {
    vi.useFakeTimers();
    const client = createStreamClient({ reconnectBaseMs: 1000 });
    const received: IndicatorStateEvent[] = [];

    client.subscribe(
      StreamKind.Indicator,
      { id: ID, period: Period.OneHour, indicator: { key: 'sma', inputs: { length: 14 } } },
      (event) => received.push(event),
    );
    const first = FakeWebSocket.instances[0];
    first?.open();
    first?.emit({
      action: 'subscribed-indicator',
      subscriptionId: 'sub-old',
      id: ID,
      period: Period.OneHour,
      indicatorKey: 'sma',
    });
    first?.close();
    vi.advanceTimersByTime(1000);
    const second = FakeWebSocket.instances[1];
    second?.open();
    second?.emit({
      action: 'subscribed-indicator',
      subscriptionId: 'sub-new',
      id: ID,
      period: Period.OneHour,
      indicatorKey: 'sma',
    });
    const event: IndicatorStateEvent = {
      subscriptionId: 'sub-new',
      id: ID,
      period: Period.OneHour,
      indicatorKey: 'sma',
      state: { time: 2000, value: 110 },
      final: true,
    };
    second?.emit(event);
    // A stale frame for the old id must be dropped after rebind.
    second?.emit({
      subscriptionId: 'sub-old',
      id: ID,
      period: Period.OneHour,
      indicatorKey: 'sma',
      state: { time: 1500, value: 99 },
      final: false,
    });

    expect({
      instances: FakeWebSocket.instances.length,
      replayed: second?.sent,
      received,
    }).toEqual({
      instances: 2,
      replayed: [
        {
          action: 'subscribe-indicator',
          id: ID,
          period: Period.OneHour,
          indicator: { key: 'sma', inputs: { length: 14 } },
        },
      ],
      received: [event],
    });
  });

  it('subscribes to a rule-event feed by id, routes a {symbolId, entry} frame to the listener, and unsubscribes by id', () => {
    const client = createStreamClient();
    const received: RuleEventEntry[] = [];

    const unsubscribe = client.subscribe(StreamKind.RuleEvent, ID, (entry) => received.push(entry));
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    const entry: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 1_000,
      firedAt: 1_001,
      ruleId: 'rule-1',
      symbolId: ID,
      context: {
        inboundEvent: {
          kind: EvaluationTriggerKind.Tick,
          ts: 1_000,
          symbolId: ID,
          price: 101,
        },
        lookupSnapshot: {
          current: 101,
          open: null,
          high: null,
          low: null,
          close: null,
          volume: null,
        },
      },
    };
    socket?.emit({ symbolId: ID, entry });
    unsubscribe();

    expect({ received, sent: socket?.sent }).toEqual({
      received: [entry],
      sent: [
        { action: 'subscribe-rule-event', id: ID },
        { action: 'unsubscribe-rule-event', id: ID },
      ],
    });
  });

  it('reconnects with backoff after an unexpected close, replaying subscriptions and firing onReconnect', () => {
    vi.useFakeTimers();
    const client = createStreamClient({ reconnectBaseMs: 1000 });
    const reconnects: number[] = [];
    client.onReconnect(() => reconnects.push(1));

    client.subscribe(StreamKind.Quote, ID, () => {});
    const first = FakeWebSocket.instances[0];
    first?.open();
    first?.close();
    vi.advanceTimersByTime(1000);
    const second = FakeWebSocket.instances[1];
    second?.open();

    expect({
      instances: FakeWebSocket.instances.length,
      replayed: second?.sent,
      reconnects: reconnects.length,
    }).toEqual({
      instances: 2,
      replayed: [{ action: 'subscribe-quote', id: ID }],
      reconnects: 1,
    });
  });
});
