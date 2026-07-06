import type { Backtest, RuleEventEntry } from '@lametrader/core';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { BacktestRunRequest } from '../../common/domain/backtest.js';
import { RuleEventEntryDto } from '../rules/dto/rule-event-entry.dto.js';
import { BacktestService, type RunningBacktestView } from './backtest.service.js';
import { BacktestDto } from './dto/backtest.dto.js';
import { BacktestEventsQueryDto } from './dto/backtest-events-query.dto.js';
import { BacktestIdParamDto } from './dto/backtest-id-param.dto.js';
import { BacktestListQueryDto } from './dto/backtest-list-query.dto.js';
import { BacktestPatchDto } from './dto/backtest-patch.dto.js';
import { BacktestRunInputDto } from './dto/backtest-run-input.dto.js';

/**
 * The RESTful `/backtests` surface over the {@link BacktestService} — one
 * resource with a run lifecycle.
 *
 * - `POST /backtests` — start a run (**202** with the `Running` backtest; **409**
 *   while another run is active; **400** on invalid input; **404** on unknown ids).
 * - `GET /backtests` — list, the in-memory running one merged in; `?status=` filters.
 * - `GET /backtests/:id` — running: params + progress; completed: the full result.
 * - `PATCH /backtests/:id` — rename (**400** while running; **404** unknown).
 * - `DELETE /backtests/:id` — running: cancel + discard; completed: delete + cascade (**204**).
 * - `GET /backtests/:id/events` — windowed run events (**400** while running; **404** unknown).
 *
 * DTOs validate input at the boundary; domain failures (`BacktestError` → 400,
 * `BacktestNotFoundError` → 404, `BacktestConflictError` → 409) are mapped by the
 * global exception filter.
 */
@ApiTags('backtests')
@Controller('backtests')
export class BacktestsController {
  /**
   * @param backtests - the backtest run + resource use-case to drive.
   */
  constructor(private readonly backtests: BacktestService) {}

  /**
   * `POST /backtests` → validate and start a run. Returns **202** with the
   * `Running` backtest, served from the in-memory job.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiResponse({ status: 202, type: BacktestDto, description: 'The started (running) backtest.' })
  start(@Body() body: BacktestRunInputDto): Promise<RunningBacktestView> {
    return this.backtests.start(toRunRequest(body));
  }

  /**
   * `GET /backtests` → all backtests (running one merged in), `?status=` filtered.
   */
  @Get()
  @ApiOkResponse({ type: BacktestDto, isArray: true, description: 'All backtests.' })
  list(@Query() query: BacktestListQueryDto): Promise<Array<Backtest | RunningBacktestView>> {
    return this.backtests.list(query.status);
  }

  /**
   * `GET /backtests/:id` → one backtest (running with progress, or completed).
   */
  @Get(':id')
  @ApiOkResponse({ type: BacktestDto, description: 'The backtest.' })
  get(@Param() params: BacktestIdParamDto): Promise<Backtest | RunningBacktestView> {
    return this.backtests.get(params.id);
  }

  /**
   * `GET /backtests/:id/events` → windowed run events (**400** while running).
   */
  @Get(':id/events')
  @ApiOkResponse({ type: RuleEventEntryDto, isArray: true, description: 'The run events window.' })
  events(
    @Param() params: BacktestIdParamDto,
    @Query() query: BacktestEventsQueryDto,
  ): Promise<RuleEventEntry[]> {
    return this.backtests.listEvents(params.id, query);
  }

  /**
   * `PATCH /backtests/:id` → rename a completed backtest (**400** while running).
   */
  @Patch(':id')
  @ApiOkResponse({ type: BacktestDto, description: 'The renamed backtest.' })
  rename(@Param() params: BacktestIdParamDto, @Body() body: BacktestPatchDto): Promise<Backtest> {
    return this.backtests.rename(params.id, body.name);
  }

  /**
   * `DELETE /backtests/:id` → cancel + discard a running backtest, or delete a
   * completed one with its events cascaded. **204** either way.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The backtest was cancelled or deleted.' })
  remove(@Param() params: BacktestIdParamDto): Promise<void> {
    return this.backtests.remove(params.id);
  }
}

/**
 * Map the validated `POST /backtests` DTO to the domain {@link BacktestRunRequest},
 * defaulting an omitted commission to none.
 */
function toRunRequest(body: BacktestRunInputDto): BacktestRunRequest {
  return {
    strategyId: body.strategyId,
    symbolId: body.symbolId,
    profileId: body.profileId,
    period: body.period,
    start: body.start,
    end: body.end,
    initialCapital: body.initialCapital,
    commission: body.commission ?? {},
  };
}
