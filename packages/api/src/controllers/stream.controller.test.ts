import {
  ConfigKey,
  EvaluationTriggerKind,
  type IndicatorStateEvent,
  Period,
  type RuleEventEntry,
  RuleEventType,
  type SymbolQuoteEvent,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import {
  type CandleEvent,
  ConfigService,
  defaultIndicators,
  IndicatorService,
  InMemoryCandleRepository,
  InMemoryConfigRepository,
  InMemoryWatchlistRepository,
  QuoteStreamService,
} from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { StreamHub } from '../stream-hub.js';
import { buildAppDeps } from '../testing/app-deps.js';

/** BTC as a watched symbol on the 1h period. */
const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC',
  exchange: 'Binance',
  periods: [Period.OneHour],
};

/** Build a crypto candle at `time` with `close` (and a uniform OHLC around it). */
const candle = (time: number, close: number) => ({
  type: SymbolType.Crypto as const,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  quoteVolume: close * 10,
  trades: 1,
});

/** One hour in ms. */
const HOUR = 3_600_000;

/**
 * A running app + the engine surface the tests drive directly.
 *
 * `service.handleCandle(...)` stands in for the polling loop — the controller-tier doesn't run polling, it just verifies the `/stream` route plumbs the engine's emissions to the right socket(s).
 */
interface TestApp {
  /** The live Fastify app (`app.close()` releases the listener). */
  app: FastifyInstance;
  /** The base URL the WebSocket connects to (`http://127.0.0.1:<port>`). */
  baseUrl: string;
  /** The engine-side stream service; tests call `handleCandle` to drive emission. */
  service: IndicatorService;
  /** Every event the engine has emitted via `onState`, in order. */
  captured: IndicatorStateEvent[];
  /** The engine-side quote stream service; tests call `handleCandle` to drive emission. */
  quoteService: QuoteStreamService;
  /** Every quote event the engine has emitted via `onQuote`, in order. */
  capturedQuotes: SymbolQuoteEvent[];
  /** The rule-event pub/sub; tests publish into it to drive fan-out. */
  ruleEventStream: StreamHub<RuleEventEntry>;
}

/**
 * A controllable hold over an async `subscribe`: the wrapped call resolves `entered` when invoked, then blocks until `release()` is called.
 *
 * Lets a test wedge the socket-close handler in between a subscribe being entered and its engine registration completing — the exact window the close/subscribe race lives in.
 */
interface SubscribeGate {
  /** Resolves once the gated `subscribe` has been entered. */
  entered: Promise<void>;
  /** Release the held `subscribe` so it proceeds to the real engine call. */
  release: () => void;
  /** Internal: invoked by the wrapper when entered. */
  markEntered: () => void;
  /** Internal: the promise the wrapper awaits before delegating. */
  held: Promise<void>;
}

/** Build a {@link SubscribeGate}. */
function makeGate(): SubscribeGate {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => (markEntered = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  return { entered, release, markEntered, held };
}

/** Wrap a service so its `subscribe` is gated, keeping every other method (unsubscribe, handleCandle) intact via the prototype chain. */
function gateSubscribe<T extends { subscribe: (arg: never) => Promise<unknown> }>(
  service: T,
  gate: SubscribeGate,
): T {
  return Object.assign(Object.create(service) as T, {
    subscribe: async (arg: never) => {
      gate.markEntered();
      await gate.held;
      return service.subscribe(arg);
    },
  });
}

/**
 * Build a listening app whose `/stream` route runs over composed in-memory candle + indicator stream hubs.
 *
 * The watchlist holds BTC and three candles are pre-stored so `sma(length: 3)` has data immediately.
 * `captured` records every `onState` emission so a test can assert that close-cleanup actually shrinks the engine's subscription map (no emissions for prior subs after the socket goes away).
 *
 * Pass `indicatorGate` / `quoteGate` to hold the matching async `subscribe` open mid-flight (for the close-during-subscribe race).
 */
async function buildApp(
  gates: { indicatorGate?: SubscribeGate; quoteGate?: SubscribeGate } = {},
): Promise<TestApp> {
  const watchlist = new InMemoryWatchlistRepository([BTC]);
  const candles = new InMemoryCandleRepository();
  await candles.save(BTC.id, Period.OneHour, [
    candle(0, 10),
    candle(HOUR, 20),
    candle(2 * HOUR, 30),
  ]);
  const registry = defaultIndicators();
  const candleStream = new StreamHub<CandleEvent>();
  const indicatorStream = new StreamHub<IndicatorStateEvent>();
  const captured: IndicatorStateEvent[] = [];
  const service = new IndicatorService(registry, watchlist, candles, {
    onState: (event) => {
      captured.push(event);
      indicatorStream.publish(event.subscriptionId, event);
    },
  });
  const config = new ConfigService(
    new InMemoryConfigRepository([
      [ConfigKey.Periods, [Period.OneHour]],
      [ConfigKey.DefaultPeriod, Period.OneHour],
    ]),
  );
  const quoteStream = new StreamHub<SymbolQuoteEvent>();
  const capturedQuotes: SymbolQuoteEvent[] = [];
  const quoteService = new QuoteStreamService(watchlist, config, candles, {
    onQuote: (event) => {
      capturedQuotes.push(event);
      quoteStream.publish(event.subscriptionId, event);
    },
  });
  const ruleEventStream = new StreamHub<RuleEventEntry>();
  const app = createApp(
    buildAppDeps({
      indicators: { registry, compute: service },
      liveStream: {
        candleStream,
        indicatorStream,
        indicatorService: gates.indicatorGate
          ? gateSubscribe(service, gates.indicatorGate)
          : service,
        quoteStream,
        quoteStreamService: gates.quoteGate
          ? gateSubscribe(quoteService, gates.quoteGate)
          : quoteService,
        ruleEventStream,
      },
    }),
  );
  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, baseUrl, service, captured, quoteService, capturedQuotes, ruleEventStream };
}

/** Open a WebSocket against `/stream` and resolve once open. */
async function openSocket(baseUrl: string): Promise<WebSocket> {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/stream`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('ws failed to open')));
  });
  return socket;
}

/** Resolve with the next frame the socket receives (parsed as JSON). */
function nextFrame(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      socket.removeEventListener('message', listener);
      resolve(JSON.parse(String(event.data)));
    };
    socket.addEventListener('message', listener);
  });
}

/**
 * Attach a recorder for every frame the socket receives from now on.
 *
 * Returns the array events land in (so a test asserts the full sequence with one `toEqual`) and a `stop` to detach the listener.
 */
function recordFrames(socket: WebSocket): { frames: unknown[]; stop: () => void } {
  const frames: unknown[] = [];
  const listener = (event: MessageEvent) => {
    frames.push(JSON.parse(String(event.data)));
  };
  socket.addEventListener('message', listener);
  return { frames, stop: () => socket.removeEventListener('message', listener) };
}

/**
 * Send `subscribe-indicator` for SMA with the given `inputs` and resolve with the ack frame.
 *
 * Encapsulates the ack-await pattern so each test reads its intent (subscribe + use the id) rather than its plumbing.
 */
async function subscribeIndicator(
  socket: WebSocket,
  inputs: Record<string, unknown>,
): Promise<{
  action: 'subscribed-indicator';
  subscriptionId: string;
  id: string;
  period: Period;
  indicatorKey: string;
}> {
  const ackPromise = nextFrame(socket);
  socket.send(
    JSON.stringify({
      action: 'subscribe-indicator',
      id: BTC.id,
      period: Period.OneHour,
      indicator: { key: 'sma', inputs },
    }),
  );
  return (await ackPromise) as {
    action: 'subscribed-indicator';
    subscriptionId: string;
    id: string;
    period: Period;
    indicatorKey: string;
  };
}

/** Send `subscribe-quote` for BTC and resolve with the ack frame. */
async function subscribeQuote(socket: WebSocket): Promise<{
  action: 'subscribed-quote';
  subscriptionId: string;
  id: string;
  period: Period;
}> {
  const ackPromise = nextFrame(socket);
  socket.send(JSON.stringify({ action: 'subscribe-quote', id: BTC.id }));
  return (await ackPromise) as {
    action: 'subscribed-quote';
    subscriptionId: string;
    id: string;
    period: Period;
  };
}

/** Settle pending WS frames + server-side message processing before the next assertion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('/stream subscribe-indicator', () => {
  it('replies with an ack frame carrying a server-generated subscriptionId', async () => {
    const { app, baseUrl } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      const ack = await subscribeIndicator(socket, { length: 3 });

      expect(ack).toEqual({
        action: 'subscribed-indicator',
        subscriptionId: expect.any(String),
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
      });

      socket.close();
    } finally {
      await app.close();
    }
  });

  it('answers a malformed indicator-subscribe message with an error frame', async () => {
    const { app, baseUrl } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      const framePromise = nextFrame(socket);
      // Missing both `period` and `indicator` — the controller rejects this at the boundary.
      socket.send(JSON.stringify({ action: 'subscribe-indicator', id: BTC.id }));
      const frame = await framePromise;

      expect(frame).toEqual({ error: 'invalid subscribe-indicator message' });

      socket.close();
    } finally {
      await app.close();
    }
  });
});

describe('/stream indicator state delivery', () => {
  it('delivers state events to the subscribing socket only, not to other connected sockets', async () => {
    const { app, baseUrl, service } = await buildApp();
    try {
      const a = await openSocket(baseUrl);
      const b = await openSocket(baseUrl);
      const ack = await subscribeIndicator(a, { length: 3 });
      const aRec = recordFrames(a);
      const bRec = recordFrames(b);

      // SMA(3) over closes [10,20,30] at time=2*HOUR is mean(10,20,30) = 20.
      await service.handleCandle({
        id: BTC.id,
        period: Period.OneHour,
        candle: candle(2 * HOUR, 30),
        final: true,
      });
      await settle();

      expect(aRec.frames).toEqual([
        {
          subscriptionId: ack.subscriptionId,
          id: BTC.id,
          period: Period.OneHour,
          indicatorKey: 'sma',
          state: { time: 2 * HOUR, value: expect.closeTo(20, 6) },
          final: true,
        },
      ]);
      expect(bRec.frames).toEqual([]);

      aRec.stop();
      bRec.stop();
      a.close();
      b.close();
    } finally {
      await app.close();
    }
  });

  it('stops delivering frames for an unsubscribed subscriptionId; the sockets other subscriptions are unaffected', async () => {
    const { app, baseUrl, service } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      const ack1 = await subscribeIndicator(socket, { length: 3 });
      const ack2 = await subscribeIndicator(socket, { length: 2 });

      socket.send(
        JSON.stringify({ action: 'unsubscribe-indicator', subscriptionId: ack1.subscriptionId }),
      );
      await settle();

      const rec = recordFrames(socket);
      await service.handleCandle({
        id: BTC.id,
        period: Period.OneHour,
        candle: candle(2 * HOUR, 30),
        final: true,
      });
      await settle();

      // Only sub2 (length=2) still fires; SMA(2) at time=2*HOUR over [20,30] is 25.
      expect(rec.frames).toEqual([
        {
          subscriptionId: ack2.subscriptionId,
          id: BTC.id,
          period: Period.OneHour,
          indicatorKey: 'sma',
          state: { time: 2 * HOUR, value: expect.closeTo(25, 6) },
          final: true,
        },
      ]);

      rec.stop();
      socket.close();
    } finally {
      await app.close();
    }
  });

  it('releases every indicator subscription on the socket when the socket closes', async () => {
    const { app, baseUrl, service, captured } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      await subscribeIndicator(socket, { length: 3 });
      await subscribeIndicator(socket, { length: 2 });
      socket.close();
      await settle();

      // Clear any pre-close emissions and verify the engine's subscription map is now empty:
      // a matching candle reaches no subscribers, so `onState` is never invoked.
      captured.length = 0;
      await service.handleCandle({
        id: BTC.id,
        period: Period.OneHour,
        candle: candle(2 * HOUR, 30),
        final: true,
      });

      expect(captured).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('releases an indicator subscription that completes after the socket has already closed', async () => {
    const gate = makeGate();
    const { app, baseUrl, service, captured } = await buildApp({ indicatorGate: gate });
    try {
      const socket = await openSocket(baseUrl);
      socket.send(
        JSON.stringify({
          action: 'subscribe-indicator',
          id: BTC.id,
          period: Period.OneHour,
          indicator: { key: 'sma', inputs: { length: 3 } },
        }),
      );
      // Close while the subscribe is still wedged inside the gate, then let it finish.
      await gate.entered;
      socket.close();
      await settle();
      gate.release();
      await settle();

      // The late-resolving subscribe must tear itself down: a matching candle reaches no subscribers.
      captured.length = 0;
      await service.handleCandle({
        id: BTC.id,
        period: Period.OneHour,
        candle: candle(2 * HOUR, 30),
        final: true,
      });

      expect(captured).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

describe('/stream subscribe-quote', () => {
  it('replies with an ack frame carrying a server-generated subscriptionId', async () => {
    const { app, baseUrl } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      const ack = await subscribeQuote(socket);

      expect(ack).toEqual({
        action: 'subscribed-quote',
        subscriptionId: expect.any(String),
        id: BTC.id,
        period: Period.OneHour,
      });

      socket.close();
    } finally {
      await app.close();
    }
  });

  it('answers a malformed quote-subscribe message with an error frame', async () => {
    const { app, baseUrl } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      const framePromise = nextFrame(socket);
      // Missing `id` — the controller rejects this at the boundary.
      socket.send(JSON.stringify({ action: 'subscribe-quote' }));
      const frame = await framePromise;

      expect(frame).toEqual({ error: 'subscribe-quote requires id: string' });

      socket.close();
    } finally {
      await app.close();
    }
  });
});

describe('/stream quote delivery', () => {
  it('delivers quote frames to the subscribing socket only, not to other connected sockets', async () => {
    const { app, baseUrl, quoteService } = await buildApp();
    try {
      const a = await openSocket(baseUrl);
      const b = await openSocket(baseUrl);
      const ack = await subscribeQuote(a);
      const aRec = recordFrames(a);
      const bRec = recordFrames(b);

      // previous bar is candle(HOUR, 20); the closed candle(2*HOUR, 30) → change 10, changePct 0.5.
      quoteService.handleCandle({
        id: BTC.id,
        period: Period.OneHour,
        candle: candle(2 * HOUR, 30),
        final: true,
      });
      await settle();

      expect(aRec.frames).toEqual([
        {
          subscriptionId: ack.subscriptionId,
          id: BTC.id,
          period: Period.OneHour,
          quote: {
            price: 30,
            change: expect.closeTo(10, 6),
            changePct: expect.closeTo(0.5, 6),
            time: 2 * HOUR,
          },
          final: true,
        },
      ]);
      expect(bRec.frames).toEqual([]);

      aRec.stop();
      bRec.stop();
      a.close();
      b.close();
    } finally {
      await app.close();
    }
  });

  it('stops delivering frames for an unsubscribed subscriptionId; the sockets other subscriptions are unaffected', async () => {
    const { app, baseUrl, quoteService } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      const ack1 = await subscribeQuote(socket);
      const ack2 = await subscribeQuote(socket);

      socket.send(
        JSON.stringify({ action: 'unsubscribe-quote', subscriptionId: ack1.subscriptionId }),
      );
      await settle();

      const rec = recordFrames(socket);
      quoteService.handleCandle({
        id: BTC.id,
        period: Period.OneHour,
        candle: candle(2 * HOUR, 30),
        final: true,
      });
      await settle();

      // Only sub2 still fires.
      expect(rec.frames).toEqual([
        {
          subscriptionId: ack2.subscriptionId,
          id: BTC.id,
          period: Period.OneHour,
          quote: {
            price: 30,
            change: expect.closeTo(10, 6),
            changePct: expect.closeTo(0.5, 6),
            time: 2 * HOUR,
          },
          final: true,
        },
      ]);

      rec.stop();
      socket.close();
    } finally {
      await app.close();
    }
  });

  it('releases every quote subscription on the socket when the socket closes', async () => {
    const { app, baseUrl, quoteService, capturedQuotes } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      await subscribeQuote(socket);
      await subscribeQuote(socket);
      socket.close();
      await settle();

      // The engine's quote subscription map is now empty: a matching candle reaches no subscribers.
      capturedQuotes.length = 0;
      quoteService.handleCandle({
        id: BTC.id,
        period: Period.OneHour,
        candle: candle(2 * HOUR, 30),
        final: true,
      });

      expect(capturedQuotes).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('releases a quote subscription that completes after the socket has already closed', async () => {
    const gate = makeGate();
    const { app, baseUrl, quoteService, capturedQuotes } = await buildApp({ quoteGate: gate });
    try {
      const socket = await openSocket(baseUrl);
      socket.send(JSON.stringify({ action: 'subscribe-quote', id: BTC.id }));
      // Close while the subscribe is still wedged inside the gate, then let it finish.
      await gate.entered;
      socket.close();
      await settle();
      gate.release();
      await settle();

      // The late-resolving subscribe must tear itself down: a matching candle reaches no subscribers.
      capturedQuotes.length = 0;
      quoteService.handleCandle({
        id: BTC.id,
        period: Period.OneHour,
        candle: candle(2 * HOUR, 30),
        final: true,
      });

      expect(capturedQuotes).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

/** A `Fired` umbrella rule-event entry for BTC at `ts`, stamped with `firedAt`. */
function firedEntry(ts: number): RuleEventEntry {
  return {
    type: RuleEventType.Fired,
    ts,
    firedAt: ts + 1,
    ruleId: 'rule-1',
    symbolId: BTC.id,
    context: {
      inboundEvent: {
        kind: EvaluationTriggerKind.Tick,
        ts,
        symbolId: BTC.id,
        price: 100,
      },
      lookupSnapshot: {
        current: 100,
        open: null,
        high: null,
        low: null,
        close: null,
        volume: null,
      },
    },
  };
}

describe('/stream subscribe-rule-event', () => {
  it('delivers each published rule-event entry to the subscribing socket as a symbolId-tagged frame', async () => {
    const { app, baseUrl, ruleEventStream } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      const rec = recordFrames(socket);
      socket.send(JSON.stringify({ action: 'subscribe-rule-event', id: BTC.id }));
      await settle();

      const entry = firedEntry(1_000);
      ruleEventStream.publish(BTC.id, entry);
      await settle();

      expect(rec.frames).toEqual([{ symbolId: BTC.id, entry }]);

      rec.stop();
      socket.close();
    } finally {
      await app.close();
    }
  });

  it('answers a missing-id subscribe-rule-event with an error frame', async () => {
    const { app, baseUrl } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      const framePromise = nextFrame(socket);
      socket.send(JSON.stringify({ action: 'subscribe-rule-event' }));
      const frame = await framePromise;

      expect(frame).toEqual({ error: 'subscribe-rule-event requires id: string' });

      socket.close();
    } finally {
      await app.close();
    }
  });

  it('stops delivering frames after an unsubscribe-rule-event for the same id', async () => {
    const { app, baseUrl, ruleEventStream } = await buildApp();
    try {
      const socket = await openSocket(baseUrl);
      socket.send(JSON.stringify({ action: 'subscribe-rule-event', id: BTC.id }));
      await settle();
      socket.send(JSON.stringify({ action: 'unsubscribe-rule-event', id: BTC.id }));
      await settle();

      const rec = recordFrames(socket);
      ruleEventStream.publish(BTC.id, firedEntry(1_000));
      await settle();

      expect(rec.frames).toEqual([]);

      rec.stop();
      socket.close();
    } finally {
      await app.close();
    }
  });
});
