import { getLogger } from '../log.js';
import { toWsUrl } from '../ws/json-socket.js';
import {
  type IndicatorStreamKey,
  type StreamClient,
  type StreamClientOptions,
  StreamKind,
  type StreamListener,
  type StreamSubscribeKey,
  type Unsubscribe,
} from './stream-client.types.js';

/** Scoped logger for the shared stream client. */
const log = getLogger('stream-client');

/** Default first reconnect delay; doubles per attempt up to {@link DEFAULT_MAX_MS}. */
const DEFAULT_BASE_MS = 1000;
/** Default reconnect-delay ceiling. */
const DEFAULT_MAX_MS = 30_000;

/**
 * One logical (ref-counted) subscription: a logical key shared by any number of
 * local listeners. The upstream subscribe is sent for the first listener and the
 * upstream unsubscribe when the last one leaves.
 *
 * The `key` discriminant carries the kind: candle / quote subscriptions carry a
 * plain `id`, indicator subscriptions carry the structured `(id, period,
 * indicator)` tuple.
 */
interface Subscription {
  /** Which stream this is. */
  kind: StreamKind;
  /** Canonical symbol id for candle / quote; mirror of `indicatorKey.id` for indicator. */
  id: string;
  /** Structured indicator-subscribe payload — only set on indicator subscriptions. */
  indicatorKey?: IndicatorStreamKey;
  /** The local listeners sharing this upstream subscription. */
  listeners: Set<(event: unknown) => void>;
  /** For quote / indicator subscriptions: the server-assigned id (learned from the reply). */
  subscriptionId?: string;
}

/** Stable JSON of `indicator.inputs` so distinct attribute orderings yield the same registry key. */
function stableInputs(inputs: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(inputs)
      .sort()
      .map((k) => [k, inputs[k]] as const),
  );
}

/** Build the registry key for one subscription — kind-specific to keep namespaces separate. */
function keyOf<K extends StreamKind>(kind: K, raw: StreamSubscribeKey<K>): string {
  if (kind === StreamKind.Indicator) {
    const ind = raw as IndicatorStreamKey;
    return `${kind}:${ind.id}:${ind.period}:${ind.indicator.key}:${stableInputs(ind.indicator.inputs)}`;
  }
  return `${kind}:${raw as string}`;
}

/**
 * Build a `/stream` connection manager: a single shared `WebSocket` multiplexing
 * every subscription (candle, quote, indicator), with ref-counted registrations,
 * frame routing that hides the per-kind protocol asymmetry, and exponential-
 * backoff reconnect that replays subscriptions and notifies `onReconnect`
 * listeners.
 *
 * Frames are only written when the socket is `OPEN`; otherwise the registry is
 * the source of truth and the `open` handler (re)sends a subscribe for every
 * active key — so first-connect and reconnect share one replay path and no
 * outbound queue is needed.
 *
 * The app uses the {@link streamClient} singleton; tests build isolated instances
 * (and stub the global `WebSocket`).
 *
 * @param options - socket path + reconnect tuning (all defaulted).
 */
export function createStreamClient(options: StreamClientOptions = {}): StreamClient {
  const path = options.path ?? '/stream';
  const baseMs = options.reconnectBaseMs ?? DEFAULT_BASE_MS;
  const maxMs = options.reconnectMaxMs ?? DEFAULT_MAX_MS;

  /** Active subscriptions keyed by `keyOf(kind, raw)`. */
  const subscriptions = new Map<string, Subscription>();
  /** Index from a server-assigned `subscriptionId` (quote or indicator) to its registry key, for frame routing. */
  const subscriptionIdToKey = new Map<string, string>();
  /** Callbacks fired after a transparent reconnect. */
  const reconnectListeners = new Set<() => void>();

  let socket: WebSocket | null = null;
  /** Number of consecutive reconnect attempts (drives the backoff delay). */
  let reconnectAttempts = 0;
  /** Pending reconnect timer, or `null` when none is scheduled. */
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once the socket has opened at least once (so we can tell reconnects apart). */
  let everOpened = false;
  /** True when we deliberately closed the socket (so `close` doesn't reconnect). */
  let intentionalClose = false;

  /** Send the upstream subscribe verb for one subscription (caller ensures OPEN). */
  function sendSubscribe(subscription: Subscription): void {
    if (subscription.kind === StreamKind.Quote) {
      socket?.send(JSON.stringify({ action: 'subscribe-quote', id: subscription.id }));
      return;
    }
    if (subscription.kind === StreamKind.Indicator && subscription.indicatorKey) {
      const { id, period, indicator } = subscription.indicatorKey;
      socket?.send(JSON.stringify({ action: 'subscribe-indicator', id, period, indicator }));
      return;
    }
    socket?.send(JSON.stringify({ action: 'subscribe', id: subscription.id }));
  }

  /** Send the upstream unsubscribe verb for one subscription, if the socket is open. */
  function sendUnsubscribe(subscription: Subscription): void {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (subscription.kind === StreamKind.Quote) {
      if (subscription.subscriptionId) {
        socket.send(
          JSON.stringify({
            action: 'unsubscribe-quote',
            subscriptionId: subscription.subscriptionId,
          }),
        );
      }
      return;
    }
    if (subscription.kind === StreamKind.Indicator) {
      // Only release upstream once the server has bound a subscriptionId — otherwise
      // there's nothing for it to free, and an unbound unsubscribe would be invalid.
      if (subscription.subscriptionId) {
        socket.send(
          JSON.stringify({
            action: 'unsubscribe-indicator',
            subscriptionId: subscription.subscriptionId,
          }),
        );
      }
      return;
    }
    socket.send(JSON.stringify({ action: 'unsubscribe', id: subscription.id }));
  }

  /** Deliver a routed frame to every listener of a subscription. */
  function deliver(subscription: Subscription | undefined, frame: unknown): void {
    if (!subscription) return;
    for (const listener of subscription.listeners) listener(frame);
  }

  /** Route one parsed inbound frame to the matching subscription(s). */
  function route(frame: Record<string, unknown>): void {
    if (frame.action === 'subscribed-quote' && typeof frame.id === 'string') {
      const subscription = subscriptions.get(keyOf(StreamKind.Quote, frame.id));
      if (subscription && typeof frame.subscriptionId === 'string') {
        subscription.subscriptionId = frame.subscriptionId;
        subscriptionIdToKey.set(frame.subscriptionId, keyOf(StreamKind.Quote, frame.id));
      }
      return;
    }
    if (frame.action === 'subscribed-indicator' && typeof frame.subscriptionId === 'string') {
      // The reply identifies the subscription by its tuple; match it to the
      // pending registry entry (only one indicator-subscribe per tuple is in flight
      // at a time, so a single matching pass is enough).
      for (const [key, subscription] of subscriptions) {
        if (subscription.kind !== StreamKind.Indicator || subscription.subscriptionId) continue;
        const ind = subscription.indicatorKey;
        if (!ind) continue;
        if (
          ind.id === frame.id &&
          ind.period === frame.period &&
          ind.indicator.key === frame.indicatorKey
        ) {
          subscription.subscriptionId = frame.subscriptionId;
          subscriptionIdToKey.set(frame.subscriptionId, key);
          break;
        }
      }
      return;
    }
    if (typeof frame.subscriptionId === 'string' && ('quote' in frame || 'state' in frame)) {
      const key = subscriptionIdToKey.get(frame.subscriptionId);
      if (!key) {
        log.warn({ subscriptionId: frame.subscriptionId }, 'frame for unknown subscription');
        return;
      }
      deliver(subscriptions.get(key), frame);
      return;
    }
    if ('candle' in frame && typeof frame.id === 'string') {
      deliver(subscriptions.get(keyOf(StreamKind.Candle, frame.id)), frame);
      return;
    }
    if ('error' in frame) {
      log.warn({ frame }, 'stream error frame');
    }
  }

  /** Open the shared socket if one isn't already connecting/open, wiring handlers. */
  function ensureSocket(): void {
    if (
      socket &&
      (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
    )
      return;
    intentionalClose = false;
    socket = new WebSocket(toWsUrl(path));
    socket.addEventListener('open', onOpen);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', () => log.warn('stream socket error'));
  }

  /** On open: reset backoff, replay every subscription, then fire reconnect hooks. */
  function onOpen(): void {
    reconnectAttempts = 0;
    // The server reassigns quote / indicator subscription ids on a fresh socket,
    // so drop the stale correlation before replaying.
    subscriptionIdToKey.clear();
    for (const subscription of subscriptions.values()) {
      subscription.subscriptionId = undefined;
      sendSubscribe(subscription);
    }
    if (everOpened) for (const listener of reconnectListeners) listener();
    everOpened = true;
  }

  /** Parse and route an inbound message; a malformed frame is logged and dropped. */
  function onMessage(event: MessageEvent): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch (cause) {
      log.warn({ err: cause }, 'failed to parse stream frame');
      return;
    }
    route(frame);
  }

  /** On an unexpected close, schedule a backoff reconnect while subscriptions remain. */
  function onClose(): void {
    socket = null;
    if (intentionalClose || subscriptions.size === 0) return;
    const delay = Math.min(baseMs * 2 ** reconnectAttempts, maxMs);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureSocket();
    }, delay);
  }

  function subscribe<K extends StreamKind>(
    kind: K,
    rawKey: StreamSubscribeKey<K>,
    listener: StreamListener<K>,
  ): Unsubscribe {
    const key = keyOf(kind, rawKey);
    let subscription = subscriptions.get(key);
    const erased = listener as (event: unknown) => void;
    if (!subscription) {
      subscription = {
        kind,
        id: kind === StreamKind.Indicator ? (rawKey as IndicatorStreamKey).id : (rawKey as string),
        indicatorKey: kind === StreamKind.Indicator ? (rawKey as IndicatorStreamKey) : undefined,
        listeners: new Set([erased]),
      };
      subscriptions.set(key, subscription);
      if (socket?.readyState === WebSocket.OPEN) sendSubscribe(subscription);
      else ensureSocket();
    } else {
      subscription.listeners.add(erased);
    }
    return () => {
      const current = subscriptions.get(key);
      if (!current) return;
      // Only the last listener for a key releases the upstream subscription.
      if (!current.listeners.delete(erased) || current.listeners.size > 0) return;
      sendUnsubscribe(current);
      if (current.subscriptionId) subscriptionIdToKey.delete(current.subscriptionId);
      subscriptions.delete(key);
      if (subscriptions.size === 0) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        intentionalClose = true;
        socket?.close();
        socket = null;
        // A later subscription opens a fresh socket; that first open is a first
        // connect, not a reconnect, so don't fire onReconnect for it.
        everOpened = false;
      }
    };
  }

  function onReconnect(listener: () => void): Unsubscribe {
    reconnectListeners.add(listener);
    return () => {
      reconnectListeners.delete(listener);
    };
  }

  return { subscribe, onReconnect };
}

/** The app-wide shared `/stream` client; the hooks subscribe through this. */
export const streamClient = createStreamClient();
