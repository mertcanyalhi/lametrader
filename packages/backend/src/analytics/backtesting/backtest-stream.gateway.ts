import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { BacktestFrame } from '@lametrader/core';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { StreamHub } from '../../common/services/stream-hub.js';
import { BacktestService } from './backtest.service.js';
import { BACKTEST_STREAM } from './backtest-stream.token.js';

/**
 * The exact URL of the per-run backtest stream WebSocket: `/backtests/:id/stream`.
 *
 * `id` is an opaque backtest id (a nanoid — no slash, so `[^/]+` captures it
 * whole); the anchors pin the whole path so no other route is mistaken for this
 * one.
 */
const STREAM_PATH = /^\/backtests\/([^/]+)\/stream$/;

/**
 * Match an upgrade request URL against {@link STREAM_PATH}, returning the decoded
 * backtest id or `null` when it is not a backtest-stream URL. Any query string is
 * stripped before matching, and the captured id is percent-decoded to match how
 * Express would resolve a `:param`.
 */
function matchStreamPath(url: string): string | null {
  const path = url.split('?')[0] ?? '';
  const matched = STREAM_PATH.exec(path);
  if (!matched) return null;
  const [, rawId] = matched;
  if (rawId === undefined) return null;
  return decodeURIComponent(rawId);
}

/**
 * The per-run backtest stream WebSocket at `WS /backtests/:id/stream` (spec:
 * *API → stream*, *Stream protocol*).
 *
 * Like the backfill-progress and `/stream` gateways it drives a raw `ws` server
 * in `noServer` mode and handles the HTTP `upgrade` itself, matching **only**
 * {@link STREAM_PATH} and ignoring every other upgrade so all raw-`ws` gateways
 * coexist on the one server.
 *
 * The protocol:
 *
 * - For an active run: subscribe to the run's frame stream first, then send the
 *   current snapshot — so a delta (or the terminal `Completed` frame) firing in
 *   between is delivered rather than missed. Reading the snapshot and
 *   subscribing happen in one synchronous step, so a frame published between the
 *   two can never slip ahead of the snapshot.
 * - For a run that has already completed (persisted): send a single completed
 *   snapshot, then close — there is nothing left to tail.
 * - For an unknown id: a single `{ error }` frame, then close.
 */
@Injectable()
export class BacktestStreamGateway implements OnApplicationBootstrap, OnModuleDestroy {
  /** Scoped logger for attach/detach lifecycle. */
  private readonly logger = new Logger(BacktestStreamGateway.name);

  /** The raw `ws` server, created on bootstrap. */
  private wss?: WebSocketServer;

  /** The HTTP server the upgrade listener is attached to (for detach). */
  private httpServer?: HttpServer;

  /** The bound upgrade listener, retained so it can be removed on shutdown. */
  private upgradeListener?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

  /**
   * @param adapterHost - resolves the underlying Node HTTP server to attach to.
   * @param backtests - the run registry (read for the snapshot + existence guard).
   * @param hub - the per-run frame stream this gateway fans out to sockets.
   */
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly backtests: BacktestService,
    @Inject(BACKTEST_STREAM) private readonly hub: StreamHub<BacktestFrame>,
  ) {}

  /**
   * Attach the `noServer` `ws` server to the HTTP server's `upgrade` event once
   * the app has bootstrapped (the HTTP adapter — and its server — exist by then).
   */
  onApplicationBootstrap(): void {
    const httpAdapter = this.adapterHost.httpAdapter;
    if (!httpAdapter) {
      this.logger.warn('no HTTP adapter; backtest-stream WebSocket not attached');
      return;
    }
    const server = httpAdapter.getHttpServer() as HttpServer;
    const wss = new WebSocketServer({ noServer: true });
    const upgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
      const id = matchStreamPath(request.url ?? '');
      if (id === null) return; // Not our path — leave the socket for other upgrade handlers.
      wss.handleUpgrade(request, socket, head, (client) => {
        this.handleConnection(client, id);
      });
    };
    server.on('upgrade', upgradeListener);
    this.wss = wss;
    this.httpServer = server;
    this.upgradeListener = upgradeListener;
  }

  /**
   * Detach the upgrade listener and close the `ws` server on shutdown, so a
   * closed app leaves no dangling handler on the HTTP server.
   */
  onModuleDestroy(): void {
    if (this.httpServer && this.upgradeListener) {
      this.httpServer.removeListener('upgrade', this.upgradeListener);
    }
    this.wss?.close();
  }

  /**
   * Run the per-run stream protocol on a freshly-upgraded socket.
   */
  private handleConnection(socket: WsSocket, id: string): void {
    const snapshot = this.backtests.activeSnapshotFrame(id);
    if (snapshot !== null) {
      // Subscribe first, then send the snapshot — both synchronously, so a delta
      // published between the two cannot slip ahead of the snapshot.
      const unsubscribe = this.hub.subscribe(id, (frame) => socket.send(JSON.stringify(frame)));
      socket.on('close', unsubscribe);
      socket.send(JSON.stringify(snapshot));
      return;
    }
    void this.sendPersistedThenClose(socket, id);
  }

  /**
   * Send a completed backtest's snapshot (or an error for an unknown id), then
   * close — there is no active run to tail.
   */
  private async sendPersistedThenClose(socket: WsSocket, id: string): Promise<void> {
    const persisted = await this.backtests.persistedSnapshotFrame(id);
    if (persisted === null) {
      socket.send(JSON.stringify({ error: `backtest not found: ${id}` }));
    } else {
      socket.send(JSON.stringify(persisted));
    }
    socket.close();
  }
}
