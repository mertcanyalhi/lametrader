import { createApp, StreamHub } from '@lametrader/api';
import {
  type IndicatorStateEvent,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  StateValueType,
  type SymbolQuoteEvent,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SYMBOL_ID = 'crypto:BTCUSDT';

/** A `StateSet` entry with stable fields for full-payload `toEqual`. */
const STATE_SET_ENTRY: RuleEventEntry = {
  type: RuleEventType.StateSet,
  ts: 1_700_000_100_000,
  firedAt: 1_700_000_100_500,
  ruleId: 'r-1',
  symbolId: SYMBOL_ID,
  scope: StateScope.Symbol,
  key: 'streak',
  value: { type: StateValueType.Number, value: 3 },
};

describe('/stream rule-event subscriptions (e2e)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let ruleEventStream: StreamHub<RuleEventEntry>;

  beforeAll(async () => {
    const watchlist = new InMemoryWatchlistRepository();
    const candles = new InMemoryCandleRepository();
    const config = new ConfigService(new InMemoryConfigRepository());
    const registry = defaultIndicators();
    const indicatorService = new IndicatorService(registry, watchlist, candles);
    const candleStream = new StreamHub<CandleEvent>();
    const indicatorStream = new StreamHub<IndicatorStateEvent>();
    const quoteStream = new StreamHub<SymbolQuoteEvent>();
    const quoteStreamService = new QuoteStreamService(watchlist, config, candles, {
      onQuote: (event) => quoteStream.publish(event.subscriptionId, event),
    });
    ruleEventStream = new StreamHub<RuleEventEntry>();

    app = createApp({
      config,
      indicators: { registry, compute: indicatorService },
      liveStream: {
        candleStream,
        indicatorStream,
        indicatorService,
        quoteStream,
        quoteStreamService,
        ruleEventStream,
      },
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('forwards a published entry as one {symbolId, entry} frame to a subscribed socket, stops after unsubscribe, and emits an error frame for a malformed subscribe', async () => {
    const socket = await openSocket(baseUrl);
    const { frames, stop } = recordFrames(socket);

    socket.send(JSON.stringify({ action: 'subscribe-rule-event', id: SYMBOL_ID }));
    await settle();

    ruleEventStream.publish(SYMBOL_ID, STATE_SET_ENTRY);
    await settle();

    socket.send(JSON.stringify({ action: 'unsubscribe-rule-event', id: SYMBOL_ID }));
    await settle();

    ruleEventStream.publish(SYMBOL_ID, STATE_SET_ENTRY);
    await settle();

    socket.send(JSON.stringify({ action: 'subscribe-rule-event' }));
    await settle();

    ruleEventStream.publish(SYMBOL_ID, STATE_SET_ENTRY);
    await settle();

    stop();
    socket.close();

    expect(frames).toEqual([
      { symbolId: SYMBOL_ID, entry: STATE_SET_ENTRY },
      { error: 'subscribe-rule-event requires id: string' },
    ]);
  });
});

/** Open a WebSocket to `/stream` and resolve once it is open. */
async function openSocket(baseUrl: string): Promise<WebSocket> {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/stream`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('ws failed to open')));
  });
  return socket;
}

/** Record every frame the socket receives until `stop()` runs. */
function recordFrames(socket: WebSocket): { frames: unknown[]; stop: () => void } {
  const frames: unknown[] = [];
  const listener = (event: MessageEvent) => {
    frames.push(JSON.parse(String(event.data)));
  };
  socket.addEventListener('message', listener);
  return { frames, stop: () => socket.removeEventListener('message', listener) };
}

/** Settle pending WS frames + server-side message processing before the next assertion. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));
