import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { parseBackfillRange, SymbolNotFoundError } from '@lametrader/core';
import type { BackfillJob, BackfillJobService, BackfillService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import {
  BackfillBodySchema,
  BackfillJobParamSchema,
  BackfillJobSchema,
  CandlePageSchema,
  CandlesQuerySchema,
} from '../schemas/candle.schema.js';
import { ErrorSchema } from '../schemas/common.schema.js';
import { SymbolIdParamSchema } from '../schemas/symbol.schema.js';
import type { StreamHub } from '../stream-hub.js';

/**
 * Register the RESTful candle/backfill routes.
 *
 * - `GET /symbols/:id/candles` reads stored candles back.
 * - `POST /symbols/:id/backfill` starts a backfill **job** and returns 202 with
 *   the running job (validation errors stay synchronous: 404/400/409).
 * - `GET /symbols/:id/backfill/jobs/:jobId` returns a job's current state.
 * - `GET /symbols/:id/backfill/jobs/:jobId/progress` (WebSocket) streams the job's
 *   snapshots, keyed by job id.
 *
 * Domain failures are mapped by the app's error handler (`SymbolNotFoundError`
 * → 404, `CandleError` → 400, `BackfillConflictError` → 409).
 *
 * @param candles - the (synchronous) backfill use-case, for reads.
 * @param jobs - the asynchronous backfill-job use-case.
 * @param hub - the per-job progress pub/sub shared with the WebSocket route.
 */
export function candlesController(
  candles: BackfillService,
  jobs: BackfillJobService,
  hub: StreamHub<BackfillJob>,
) {
  return async (instance: FastifyInstance): Promise<void> => {
    const app = instance.withTypeProvider<TypeBoxTypeProvider>();

    app.get(
      '/symbols/:id/candles',
      {
        schema: {
          tags: ['candles'],
          summary: 'Read stored candles (keyset-paginated by time)',
          params: SymbolIdParamSchema,
          querystring: CandlesQuerySchema,
          response: { 200: CandlePageSchema, 400: ErrorSchema },
        },
      },
      async (request) => {
        const { period, from, to, limit } = request.query;
        return candles.read(request.params.id, period, {
          from: from ?? 0,
          to: to ?? Number.MAX_SAFE_INTEGER,
          limit,
        });
      },
    );

    app.post(
      '/symbols/:id/backfill',
      {
        schema: {
          tags: ['candles'],
          summary: 'Start a backfill job',
          params: SymbolIdParamSchema,
          body: BackfillBodySchema,
          response: {
            202: BackfillJobSchema,
            400: ErrorSchema,
            404: ErrorSchema,
            409: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { period, from, to } = request.body;
        const range = parseBackfillRange(
          from !== undefined || to !== undefined ? { from, to } : undefined,
        );
        const job = await jobs.start(id, period, range);
        reply.code(202);
        return job;
      },
    );

    app.get(
      '/symbols/:id/backfill/jobs/:jobId',
      {
        schema: {
          tags: ['candles'],
          summary: 'Get a backfill job',
          params: BackfillJobParamSchema,
          response: { 200: BackfillJobSchema, 404: ErrorSchema },
        },
      },
      async (request) => {
        const { id, jobId } = request.params;
        const job = jobs.get(jobId);
        if (!job || job.symbolId !== id) {
          throw new SymbolNotFoundError(`backfill job not found: ${jobId}`);
        }
        return job;
      },
    );

    app.get(
      '/symbols/:id/backfill/jobs/:jobId/progress',
      { websocket: true },
      (socket, request) => {
        const { id, jobId } = request.params as { id: string; jobId: string };
        // Same ownership guard as the REST sibling: a job is only streamable under
        // its own symbol path (symbolId is immutable, so an early read is safe).
        const job = jobs.get(jobId);
        if (!job || job.symbolId !== id) {
          socket.send(JSON.stringify({ error: `backfill job not found: ${jobId}` }));
          socket.close();
          return;
        }
        // Subscribe first, then send the current snapshot — so a terminal update
        // firing in between is delivered (at worst as a duplicate frame) rather
        // than missed. Intermediate progress is not replayed.
        const unsubscribe = hub.subscribe(jobId, (job) => socket.send(JSON.stringify(job)));
        socket.on('close', unsubscribe);
        const current = jobs.get(jobId);
        if (current) socket.send(JSON.stringify(current));
      },
    );
  };
}
