import { getLogger } from '../log.js';

/** Scoped logger for the JSON socket base. */
const log = getLogger('json-socket');

/** Handlers for a {@link openJsonSocket} subscription. */
export interface JsonSocketHandlers<T> {
  /** Called with each parsed JSON frame. */
  onFrame: (frame: T) => void;
  /** Called if the socket errors. */
  onError?: () => void;
  /** Called when the socket closes. */
  onClose?: () => void;
}

/** A handle to an open socket — call {@link JsonSocket.close} to tear it down. */
export interface JsonSocket {
  /** Close the underlying WebSocket. */
  close(): void;
}

/**
 * Resolve an `/api`-relative path to an absolute WebSocket URL against the
 * current origin, mirroring how `apiFetch` proxies HTTP through `/api`. The
 * nginx proxy forwards `/api/*` upgrades to the backend.
 */
export function toWsUrl(path: string): string {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/api${path}`;
}

/**
 * Open a WebSocket to an `/api`-relative `path` and deliver each message as a
 * parsed JSON frame of type `T`. A small shared base for the app's per-resource
 * socket clients (the per-job backfill stream today; the `/stream` quote client
 * can reuse it). A frame that fails to parse is logged and skipped rather than
 * thrown, so one bad frame doesn't tear down the subscription.
 *
 * @param path - resource path under the api root, e.g. `/symbols/x/backfill/jobs/y/progress`.
 * @param handlers - frame / error / close callbacks.
 */
export function openJsonSocket<T>(path: string, handlers: JsonSocketHandlers<T>): JsonSocket {
  const socket = new WebSocket(toWsUrl(path));
  socket.addEventListener('message', (event) => {
    try {
      handlers.onFrame(JSON.parse((event as MessageEvent).data) as T);
    } catch (cause) {
      log.warn({ err: cause, path }, 'failed to parse socket frame');
    }
  });
  if (handlers.onError) socket.addEventListener('error', handlers.onError);
  if (handlers.onClose) socket.addEventListener('close', handlers.onClose);
  return {
    close: () => socket.close(),
  };
}
