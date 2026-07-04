import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { BackfillJobService } from './backfill-job.service.js';
import type { BackfillJob } from './backfill-job.types.js';
import { BACKFILL_JOB_STREAM } from './backfill-job-stream.token.js';
import type { StreamHub } from './stream-hub.js';

/**
 * The exact URL of the per-job backfill-progress WebSocket:
 * `/symbols/:id/backfill/jobs/:jobId/progress`.
 *
 * The `id` segment is a canonical symbol id (`crypto:BTCUSDT` — carries a colon
 * but no slash, so `[^/]+` captures it whole); `jobId` is an opaque job id. The
 * anchors pin the whole path so no other route is mistaken for this one.
 */
const PROGRESS_PATH = /^\/symbols\/([^/]+)\/backfill\/jobs\/([^/]+)\/progress$/;

/**
 * The `(id, jobId)` a progress-stream upgrade addresses, decoded from the path.
 */
interface ProgressTarget {
  /** Canonical symbol id from the path. */
  id: string;
  /** Job id from the path. */
  jobId: string;
}

/**
 * Match an upgrade request URL against {@link PROGRESS_PATH}, returning the
 * decoded `(id, jobId)` or `null` when it is not a progress-stream URL. Any
 * query string is stripped before matching, and each captured segment is
 * percent-decoded to match how Express would resolve a `:param`.
 */
function matchProgressPath(url: string): ProgressTarget | null {
  const path = url.split('?')[0] ?? '';
  const matched = PROGRESS_PATH.exec(path);
  if (!matched) return null;
  const [, rawId, rawJobId] = matched;
  if (rawId === undefined || rawJobId === undefined) return null;
  return { id: decodeURIComponent(rawId), jobId: decodeURIComponent(rawJobId) };
}

/**
 * The per-job backfill-progress WebSocket, reproducing the old Fastify route
 * `GET (WS) /symbols/:id/backfill/jobs/:jobId/progress` byte-for-byte so the web
 * client is unchanged.
 *
 * Nest's `@WebSocketGateway` / `WsAdapter` binds a gateway to one fixed `path`
 * and does not path-match URL params, so a param'd route like this can't ride
 * it. Instead this gateway drives a raw `ws` server in `noServer` mode and
 * handles the HTTP `upgrade` itself: it matches only {@link PROGRESS_PATH} (and
 * ignores every other upgrade, leaving it for any future WS route on the same
 * server) and then runs the exact same protocol the old adapter did:
 *
 * - subscribe to the per-job stream first, then send the current snapshot — so a
 *   terminal update firing in between is delivered (at worst a duplicate frame)
 *   rather than missed; intermediate progress is not replayed.
 * - each frame is the full {@link BackfillJob} JSON, keyed by job id so
 *   concurrent jobs never interleave.
 * - the same ownership guard as the REST sibling: a job is only streamable under
 *   its own symbol path; otherwise a single `{ error }` frame then close.
 *
 * The `ws` server is attached to the underlying Node HTTP server (resolved via
 * {@link HttpAdapterHost}) once the app has bootstrapped, and detached on
 * shutdown.
 */
@Injectable()
export class BackfillProgressGateway implements OnApplicationBootstrap, OnModuleDestroy {
  /** Scoped logger for attach/detach lifecycle. */
  private readonly logger = new Logger(BackfillProgressGateway.name);

  /** The raw `ws` server, created on bootstrap. */
  private wss?: WebSocketServer;

  /** The HTTP server the upgrade listener is attached to (for detach). */
  private httpServer?: HttpServer;

  /** The bound upgrade listener, retained so it can be removed on shutdown. */
  private upgradeListener?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

  /**
   * @param adapterHost - resolves the underlying Node HTTP server to attach to.
   * @param jobs - the backfill-job registry (read for the snapshot + ownership guard).
   * @param hub - the per-job progress stream this gateway fans out to sockets.
   */
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly jobs: BackfillJobService,
    @Inject(BACKFILL_JOB_STREAM) private readonly hub: StreamHub<BackfillJob>,
  ) {}

  /**
   * Attach the `noServer` `ws` server to the HTTP server's `upgrade` event once
   * the app has bootstrapped (the HTTP adapter — and its server — exist by then).
   */
  onApplicationBootstrap(): void {
    const httpAdapter = this.adapterHost.httpAdapter;
    if (!httpAdapter) {
      this.logger.warn('no HTTP adapter; backfill-progress WebSocket not attached');
      return;
    }
    const server = httpAdapter.getHttpServer() as HttpServer;
    const wss = new WebSocketServer({ noServer: true });
    const upgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
      const target = matchProgressPath(request.url ?? '');
      if (!target) return; // Not our path — leave the socket for other upgrade handlers.
      wss.handleUpgrade(request, socket, head, (client) => {
        this.handleConnection(client, target);
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
   * Run the per-job progress protocol on a freshly-upgraded socket.
   */
  private handleConnection(socket: WsSocket, { id, jobId }: ProgressTarget): void {
    const job = this.jobs.get(jobId);
    if (!job || job.symbolId !== id) {
      socket.send(JSON.stringify({ error: `backfill job not found: ${jobId}` }));
      socket.close();
      return;
    }
    // Subscribe first, then send the current snapshot — so a terminal update
    // firing in between is delivered (at worst a duplicate frame) rather than
    // missed. Intermediate progress is not replayed.
    const unsubscribe = this.hub.subscribe(jobId, (update) => socket.send(JSON.stringify(update)));
    socket.on('close', unsubscribe);
    const current = this.jobs.get(jobId);
    if (current) socket.send(JSON.stringify(current));
  }
}
