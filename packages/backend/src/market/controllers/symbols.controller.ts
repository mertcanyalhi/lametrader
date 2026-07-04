import type { EnrichedSymbol, Instrument, WatchedSymbol } from '@lametrader/core';
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
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { AddSymbolDto } from '../dto/add-symbol.dto.js';
import { DiscoverQueryDto } from '../dto/discover-query.dto.js';
import { EnrichedSymbolDto } from '../dto/enriched-symbol.dto.js';
import { InstrumentDto } from '../dto/instrument.dto.js';
import { ListSymbolsQueryDto } from '../dto/list-symbols-query.dto.js';
import { PatchSymbolDto } from '../dto/patch-symbol.dto.js';
import { SymbolIdParamDto } from '../dto/symbol-id-param.dto.js';
import { WatchedSymbolDto } from '../dto/watched-symbol.dto.js';
import { SymbolService } from '../services/symbol.service.js';

/**
 * The RESTful symbols surface over the {@link SymbolService}: instrument
 * discovery plus the watchlist CRUD.
 *
 * - `GET /instruments` — discover instruments across the market-data sources.
 * - `GET /symbols` — list the watchlist (`?enrich=true` attaches a quote).
 * - `POST /symbols` — add a symbol (**201**).
 * - `PATCH /symbols/:id` — change a symbol's periods (200).
 * - `DELETE /symbols/:id` — remove a symbol and its stored candles (**204**).
 *
 * DTOs validate input at the boundary and pin the OpenAPI contract; domain
 * failures (`SymbolError` → 400, `SymbolNotFoundError` → 404, `SymbolConflictError`
 * → 409, `MarketDataError` → 502) are mapped by the global exception filter.
 *
 * The nested sub-resources of a symbol (`/symbols/:id/candles`, `/state`,
 * `/indicators`, `/rule-events`) are owned by their own feature modules.
 */
@ApiTags('symbols')
@ApiExtraModels(WatchedSymbolDto, EnrichedSymbolDto)
@Controller()
export class SymbolsController {
  /**
   * @param symbols - the symbols use-case to drive.
   */
  constructor(private readonly symbols: SymbolService) {}

  /**
   * `GET /instruments` → discover instruments matching `q` (optionally filtered
   * by `type`).
   */
  @Get('instruments')
  @ApiOkResponse({ type: InstrumentDto, isArray: true, description: 'Discovered instruments.' })
  discover(@Query() query: DiscoverQueryDto): Promise<Instrument[]> {
    return this.symbols.discover(query.q, query.type);
  }

  /**
   * `GET /symbols` → the watchlist; with `?enrich=true` each item carries a
   * computed `quote`.
   */
  @Get('symbols')
  @ApiOkResponse({
    description: 'The watched symbols; enriched with a quote when `enrich=true`.',
    schema: {
      type: 'array',
      items: {
        oneOf: [
          { $ref: getSchemaPath(WatchedSymbolDto) },
          { $ref: getSchemaPath(EnrichedSymbolDto) },
        ],
      },
    },
  })
  list(@Query() query: ListSymbolsQueryDto): Promise<WatchedSymbol[] | EnrichedSymbol[]> {
    return query.enrich ? this.symbols.listWithQuotes() : this.symbols.list();
  }

  /**
   * `POST /symbols` → add a symbol to the watchlist. Returns **201** with the
   * watched symbol (parity with the old API).
   */
  @Post('symbols')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: WatchedSymbolDto, description: 'The added symbol.' })
  add(@Body() body: AddSymbolDto): Promise<WatchedSymbol> {
    return this.symbols.add(body.id, body.periods);
  }

  /**
   * `PATCH /symbols/:id` → change a watched symbol's periods.
   */
  @Patch('symbols/:id')
  @ApiOkResponse({ type: WatchedSymbolDto, description: 'The updated symbol.' })
  patch(@Param() params: SymbolIdParamDto, @Body() body: PatchSymbolDto): Promise<WatchedSymbol> {
    return this.symbols.setPeriods(params.id, body.periods);
  }

  /**
   * `DELETE /symbols/:id` → remove a symbol and its stored candles. **204**.
   */
  @Delete('symbols/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The symbol was removed.' })
  remove(@Param() params: SymbolIdParamDto): Promise<void> {
    return this.symbols.remove(params.id);
  }
}
