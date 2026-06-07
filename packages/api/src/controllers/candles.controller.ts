import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { parseBackfillRange } from '@lametrader/core';
import type { BackfillService } from '@lametrader/engine';
import type { FastifyInstance } from 'fastify';
import type { BackfillProgressHub } from '../backfill-progress-hub.js';
import {
  BackfillBodySchema,
  BackfillSummarySchema,
  CandlePageSchema,
  CandlesQuerySchema,
} from '../schemas/candle.schema.js';
import { ErrorSchema } from '../schemas/common.schema.js';
import { SymbolIdParamSchema } from '../schemas/symbol.schema.js';

/**
 * Register the RESTful candle/backfill routes against a {@link BackfillService}.
 *
 * - `POST /symbols/:id/backfill` triggers a backfill and returns its summary;
 *   per-chunk progress is published to `hub` (and to any WebSocket subscriber).
 * - `GET /symbols/:id/candles` reads stored candles back.
 * - `GET /symbols/:id/backfill/progress` (WebSocket) streams progress frames.
 *
 * Domain failures are mapped by the app's error handler (`SymbolNotFoundError`
 * → 404, `CandleError` → 400).
 *
 * @param service - the backfill use-case to drive.
 * @param hub - the progress pub/sub shared with the WebSocket route.
 */
export function candlesController(service: BackfillService, hub: BackfillProgressHub) {
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
        return service.read(request.params.id, period, {
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
          summary: 'Backfill historical candles',
          params: SymbolIdParamSchema,
          body: BackfillBodySchema,
          response: {
            200: BackfillSummarySchema,
            400: ErrorSchema,
            404: ErrorSchema,
            502: ErrorSchema,
          },
        },
      },
      async (request) => {
        const { id } = request.params;
        const { period, from, to } = request.body;
        const range = parseBackfillRange(
          from !== undefined || to !== undefined ? { from, to } : undefined,
        );
        const summary = await service.backfill(id, period, range, (progress) =>
          hub.progress(id, progress),
        );
        hub.summary(id, summary);
        return summary;
      },
    );

    app.get('/symbols/:id/backfill/progress', { websocket: true }, (socket, request) => {
      const { id } = request.params as { id: string };
      const unsubscribe = hub.subscribe(id, (frame) => socket.send(JSON.stringify(frame)));
      socket.on('close', unsubscribe);
    });
  };
}
