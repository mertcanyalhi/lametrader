import { type CandlePage } from '@lametrader/core';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { parseBackfillRange } from '../../domain/candle.js';
import { SymbolNotFoundError } from '../../domain/symbol.js';
import { BackfillService } from '../backfill/backfill.service.js';
import { BackfillJobService } from '../backfill/backfill-job.service.js';
import type { BackfillJob } from '../backfill/backfill-job.types.js';
import { BackfillBodyDto } from '../backfill/dto/backfill-body.dto.js';
import { BackfillJobDto } from '../backfill/dto/backfill-job.dto.js';
import { BackfillJobParamDto } from '../backfill/dto/backfill-job-param.dto.js';
import { CandlePageDto } from '../dto/candle-page.dto.js';
import { CandlesQueryDto } from '../dto/candles-query.dto.js';
import { SymbolIdParamDto } from '../dto/symbol-id-param.dto.js';

/**
 * The RESTful candle / backfill surface over the {@link BackfillService} (reads)
 * and {@link BackfillJobService} (async jobs) — reproducing the old Fastify
 * `candlesController` exactly.
 *
 * - `GET /symbols/:id/candles` — read a keyset-paginated page of stored candles.
 * - `POST /symbols/:id/backfill` — start a backfill **job** and return **202**
 *   with the running job (validation errors stay synchronous: 404 / 400 / 409).
 * - `GET /symbols/:id/backfill/jobs/:jobId` — a job's current state.
 *
 * The per-job progress WebSocket (`GET (WS) …/jobs/:jobId/progress`) is served by
 * the {@link import('./backfill-progress.gateway.js').BackfillProgressGateway}.
 * Domain failures are mapped by the global exception filter (`SymbolNotFoundError`
 * → 404, `CandleError` → 400, `BackfillConflictError` → 409, `MarketDataError`
 * → 502 — though an upstream failure fails the async job, not the POST).
 */
@ApiTags('candles')
@Controller()
export class CandlesController {
  /**
   * @param backfill - the synchronous backfill use-case (reads).
   * @param jobs - the asynchronous backfill-job use-case.
   */
  constructor(
    private readonly backfill: BackfillService,
    private readonly jobs: BackfillJobService,
  ) {}

  /**
   * `GET /symbols/:id/candles` → one keyset-paginated page of stored candles.
   * `from`/`to` default to the full stored range.
   */
  @Get('symbols/:id/candles')
  @ApiOkResponse({ type: CandlePageDto, description: 'One page of stored candles.' })
  read(@Param() params: SymbolIdParamDto, @Query() query: CandlesQueryDto): Promise<CandlePage> {
    return this.backfill.read(params.id, query.period, {
      from: query.from ?? 0,
      to: query.to ?? Number.MAX_SAFE_INTEGER,
      limit: query.limit,
    });
  }

  /**
   * `POST /symbols/:id/backfill` → validate synchronously, start the backfill in
   * the background, and return **202** with the running job.
   */
  @Post('symbols/:id/backfill')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: BackfillJobDto, description: 'The started (running) job.' })
  start(@Param() params: SymbolIdParamDto, @Body() body: BackfillBodyDto): Promise<BackfillJob> {
    const range = parseBackfillRange(
      body.from !== undefined || body.to !== undefined
        ? { from: body.from, to: body.to }
        : undefined,
    );
    return this.jobs.start(params.id, body.period, range);
  }

  /**
   * `GET /symbols/:id/backfill/jobs/:jobId` → the job's current state. A job is
   * only visible under its own symbol path (the same ownership guard as the WS
   * sibling); otherwise a 404.
   */
  @Get('symbols/:id/backfill/jobs/:jobId')
  @ApiOkResponse({ type: BackfillJobDto, description: 'The backfill job.' })
  job(@Param() params: BackfillJobParamDto): BackfillJob {
    const job = this.jobs.get(params.jobId);
    if (!job || job.symbolId !== params.id) {
      throw new SymbolNotFoundError(`backfill job not found: ${params.jobId}`);
    }
    return job;
  }
}
