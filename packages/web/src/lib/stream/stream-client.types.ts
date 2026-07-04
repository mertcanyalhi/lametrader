import type {
  Candle,
  IndicatorStateEvent,
  Period,
  RuleEventEntry,
  SymbolQuoteEvent,
} from '@lametrader/core';

/**
 * The kinds of subscription the multiplexed `/stream` socket carries that the
 * web consumes. Each rides the same socket but has its own control verbs and
 * frame shape (see {@link StreamEventMap}).
 */
export enum StreamKind {
  /** A symbol's candle feed (all polled periods), keyed by the client `id`. */
  Candle = 'candle',
  /** A symbol's derived quote feed, keyed by the server's `subscriptionId`. */
  Quote = 'quote',
  /** A symbol's derived indicator-state feed, keyed by `(id, period, indicator)` on the client and the server's `subscriptionId` on the wire. */
  Indicator = 'indicator',
  /**
   * A symbol's rule-event mirror feed — every {@link RuleEventEntry} appended
   * to that symbol's events log, keyed by the client `id`.
   */
  RuleEvent = 'rule-event',
}

/**
 * The web's transport mirror of the backend's `CandleEvent` — one observed candle
 * for a watched symbol+period. The backend's `CandleEvent` lives in the
 * server-only `@lametrader/server` (which the browser must not import), so the
 * contract is restated here over `core`'s {@link Candle} / {@link Period}.
 */
export interface CandleEvent {
  /** Canonical symbol id the candle belongs to. */
  id: string;
  /** The period the candle is sampled at. */
  period: Period;
  /** The candle itself, typed for its asset class. */
  candle: Candle;
  /** Whether the bar has closed (`true`) or is still forming (`false`). */
  final: boolean;
}

/**
 * The structured subscribe args for a {@link StreamKind.Indicator} stream — what
 * the server's `subscribe-indicator` verb takes.
 *
 * The same shape is the client-side registry key for ref-counting (so two
 * listeners on identical `(id, period, key, inputs)` share one upstream
 * subscription).
 */
export interface IndicatorStreamKey {
  /** Canonical symbol id. */
  id: string;
  /** Candle period the indicator is computed on. */
  period: Period;
  /** Indicator catalog key + input values. */
  indicator: {
    /** Catalog key (e.g. `'sma'`). */
    key: string;
    /** Validated input values, keyed by descriptor key. */
    inputs: Record<string, unknown>;
  };
}

/**
 * The frame type each {@link StreamKind} delivers to its listeners — candle
 * subscriptions receive {@link CandleEvent}s, quote subscriptions receive
 * {@link SymbolQuoteEvent}s, indicator subscriptions receive
 * {@link IndicatorStateEvent}s, rule-event subscriptions receive the
 * raw {@link RuleEventEntry}. Lets `subscribe`/`useStreamSubscription` be
 * generic over the kind while staying fully typed.
 */
export interface StreamEventMap {
  /** Candle subscriptions deliver {@link CandleEvent} frames. */
  [StreamKind.Candle]: CandleEvent;
  /** Quote subscriptions deliver {@link SymbolQuoteEvent} frames. */
  [StreamKind.Quote]: SymbolQuoteEvent;
  /** Indicator subscriptions deliver {@link IndicatorStateEvent} frames. */
  [StreamKind.Indicator]: IndicatorStateEvent;
  /** Rule-event subscriptions deliver {@link RuleEventEntry} payloads (the `entry` half of the `{ symbolId, entry }` wire frame). */
  [StreamKind.RuleEvent]: RuleEventEntry;
}

/**
 * The second argument to {@link StreamClient.subscribe} — a flat `string` id for
 * {@link StreamKind.Candle} / {@link StreamKind.Quote}, and the structured
 * {@link IndicatorStreamKey} for {@link StreamKind.Indicator}.
 */
export type StreamSubscribeKey<K extends StreamKind> = K extends StreamKind.Indicator
  ? IndicatorStreamKey
  : string;

/** A listener for one {@link StreamKind}'s frames. */
export type StreamListener<K extends StreamKind> = (event: StreamEventMap[K]) => void;

/** Releases a subscription (or a reconnect registration); idempotent. */
export type Unsubscribe = () => void;

/**
 * The shared `/stream` connection manager surface the hooks build on. One
 * implementation backs the whole app (a single socket); `createStreamClient`
 * builds isolated instances for tests.
 */
export interface StreamClient {
  /**
   * Subscribe `listener` to live frames for one symbol on one {@link StreamKind}.
   * The first listener for a logical key opens/uses the shared socket and sends
   * the upstream subscribe; the returned {@link Unsubscribe} releases this
   * listener (and the upstream subscription once it is the last one).
   *
   * The `key` is a plain `id` string for candle / quote, and a structured
   * {@link IndicatorStreamKey} for indicator (the indicator's `subscribe-indicator`
   * verb is scoped to `(id, period, indicator)` and the registry key matches).
   */
  subscribe<K extends StreamKind>(
    kind: K,
    key: StreamSubscribeKey<K>,
    listener: StreamListener<K>,
  ): Unsubscribe;
  /**
   * Register a callback fired after the socket transparently reconnects (and has
   * replayed its subscriptions). Lets a consumer resync derived state — e.g. the
   * watchlist refetching its snapshot. Returns an {@link Unsubscribe}.
   */
  onReconnect(listener: () => void): Unsubscribe;
}

/** Tuning + injection points for {@link createStreamClient} (all defaulted). */
export interface StreamClientOptions {
  /** The `/api`-relative socket path. Defaults to `/stream`. */
  path?: string;
  /** The first reconnect delay in ms; doubles each attempt. Defaults to `1000`. */
  reconnectBaseMs?: number;
  /** The reconnect-delay ceiling in ms. Defaults to `30_000`. */
  reconnectMaxMs?: number;
}
