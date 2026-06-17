import { getLogger } from '../log.js';
import { toWsUrl } from '../ws/json-socket.js';
import {
  type StreamClient,
  type StreamClientOptions,
  StreamKind,
  type StreamListener,
  type Unsubscribe,
} from './stream-client.types.js';

/** Scoped logger for the shared stream client. */
const log = getLogger('stream-client');

/** Default first reconnect delay; doubles per attempt up to {@link DEFAULT_MAX_MS}. */
const DEFAULT_BASE_MS = 1000;
/** Default reconnect-delay ceiling. */
const DEFAULT_MAX_MS = 30_000;

/**
 * One logical (ref-counted) subscription: a `(kind, id)` shared by any number of
 * local listeners. The upstream subscribe is sent for the first listener and the
 * upstream unsubscribe when the last one leaves.
 */
interface Subscription {
  /** Which stream this is. */
  kind: StreamKind;
  /** Canonical symbol id. */
  id: string;
  /** The local listeners sharing this upstream subscription. */
  listeners: Set<(event: unknown) => void>;
  /** For quote subscriptions: the server-assigned id (learned from the reply). */
  subscriptionId?: string;
}

/** The registry key for a `(kind, id)` subscription. */
function keyOf(kind: StreamKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Build a `/stream` connection manager: a single shared `WebSocket` multiplexing
 * every subscription, with ref-counted `(kind, id)` registrations, frame routing
 * that hides the candle-vs-quote protocol asymmetry, and exponential-backoff
 * reconnect that replays subscriptions and notifies `onReconnect` listeners.
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

  /** Active subscriptions keyed by `${kind}:${id}`. */
  const subscriptions = new Map<string, Subscription>();
  /** Index from a quote `subscriptionId` to its registry key, for frame routing. */
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
    const frame =
      subscription.kind === StreamKind.Quote
        ? { action: 'subscribe-quote', id: subscription.id }
        : { action: 'subscribe', id: subscription.id };
    socket?.send(JSON.stringify(frame));
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
    if (typeof frame.subscriptionId === 'string' && 'quote' in frame) {
      deliver(subscriptions.get(subscriptionIdToKey.get(frame.subscriptionId) ?? ''), frame);
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
    // The server reassigns quote subscription ids on a fresh socket, so drop the
    // stale correlation before replaying.
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
    id: string,
    listener: StreamListener<K>,
  ): Unsubscribe {
    const key = keyOf(kind, id);
    let subscription = subscriptions.get(key);
    const erased = listener as (event: unknown) => void;
    if (!subscription) {
      subscription = { kind, id, listeners: new Set([erased]) };
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
