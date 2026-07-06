import type { BacktestStrategy } from '@lametrader/core';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BacktestStrategyService } from './backtest-strategy.service.js';
import { BacktestStrategyDto } from './dto/backtest-strategy.dto.js';
import { BacktestStrategyIdParamDto } from './dto/backtest-strategy-id-param.dto.js';
import { BacktestStrategyInputDto } from './dto/backtest-strategy-input.dto.js';

/**
 * The RESTful `/backtest-strategies` surface over the
 * {@link BacktestStrategyService}: plain strategy CRUD, mirroring `/profiles`.
 *
 * - `GET /backtest-strategies` — list.
 * - `POST /backtest-strategies` — create (**201**).
 * - `GET /backtest-strategies/:id` — get one (200 / 404).
 * - `PUT /backtest-strategies/:id` — replace (200 / 400 / 404 / 409).
 * - `DELETE /backtest-strategies/:id` — delete (**204** / 404).
 *
 * DTOs validate input at the boundary and pin the OpenAPI contract; domain
 * failures (`BacktestStrategyError` → 400, `BacktestStrategyNotFoundError` → 404,
 * `BacktestStrategyConflictError` → 409) are mapped by the global exception
 * filter. Deleting a strategy does **not** cascade to saved backtests.
 */
@ApiTags('backtest-strategies')
@Controller('backtest-strategies')
export class BacktestStrategiesController {
  /**
   * @param strategies - the backtest-strategy use-case to drive.
   */
  constructor(private readonly strategies: BacktestStrategyService) {}

  /**
   * `GET /backtest-strategies` → list all strategies.
   */
  @Get()
  @ApiOkResponse({ type: BacktestStrategyDto, isArray: true, description: 'All strategies.' })
  list(): Promise<BacktestStrategy[]> {
    return this.strategies.list();
  }

  /**
   * `POST /backtest-strategies` → create a strategy. Returns **201**.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: BacktestStrategyDto, description: 'The created strategy.' })
  create(@Body() body: BacktestStrategyInputDto): Promise<BacktestStrategy> {
    return this.strategies.create(body);
  }

  /**
   * `GET /backtest-strategies/:id` → get one strategy.
   */
  @Get(':id')
  @ApiOkResponse({ type: BacktestStrategyDto, description: 'The strategy.' })
  get(@Param() params: BacktestStrategyIdParamDto): Promise<BacktestStrategy> {
    return this.strategies.get(params.id);
  }

  /**
   * `PUT /backtest-strategies/:id` → fully replace a strategy's mutable fields.
   */
  @Put(':id')
  @ApiOkResponse({ type: BacktestStrategyDto, description: 'The replaced strategy.' })
  replace(
    @Param() params: BacktestStrategyIdParamDto,
    @Body() body: BacktestStrategyInputDto,
  ): Promise<BacktestStrategy> {
    return this.strategies.replace(params.id, body);
  }

  /**
   * `DELETE /backtest-strategies/:id` → delete a strategy. **204**.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The strategy was deleted.' })
  remove(@Param() params: BacktestStrategyIdParamDto): Promise<void> {
    return this.strategies.remove(params.id);
  }
}
