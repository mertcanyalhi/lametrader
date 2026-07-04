import {
  type IndicatorComputeResult,
  type IndicatorDefinition,
  IndicatorError,
  IndicatorNotFoundError,
  Period,
} from '@lametrader/core';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IndicatorComputeResultDto } from './dto/indicator-compute-result.dto.js';
import { IndicatorDefinitionDto } from './dto/indicator-definition.dto.js';
import { IndicatorKeyParamDto } from './dto/indicator-key-param.dto.js';
import { SymbolIndicatorParamsDto } from './dto/symbol-indicator-params.dto.js';
import { IndicatorService } from './indicator.service.js';
import { IndicatorRegistry } from './indicator-registry.js';

/**
 * The RESTful indicator surface, reproducing the old Fastify
 * `indicatorsController` exactly — the read-only catalog and the ad-hoc
 * compute route. One controller owns routes under both the `/indicators` and
 * `/symbols/:id/indicators` prefixes:
 *
 * - `GET /indicators` — every registered `IndicatorDefinition` (descriptors only).
 * - `GET /indicators/:key` — one definition by key (200 / 404).
 * - `GET /symbols/:id/indicators/:key` — compute the indicator over the symbol's
 *   stored candles (200 / 400 / 404).
 *
 * Catalog responses serialize registered `IndicatorDefinition`s verbatim — never
 * the `compute` function. Domain failures are mapped by the global exception
 * filter: an unknown key → {@link IndicatorNotFoundError} → 404; an unwatched
 * symbol → `SymbolNotFoundError` → 404; invalid inputs / an asset-class mismatch
 * → {@link IndicatorError} → 400.
 */
@ApiTags('indicators')
@Controller()
export class IndicatorsController {
  /**
   * @param registry - the indicator catalog to read descriptors from.
   * @param indicators - the compute use-case driving the symbol-scoped route.
   */
  constructor(
    private readonly registry: IndicatorRegistry,
    private readonly indicators: IndicatorService,
  ) {}

  /**
   * `GET /indicators` → every registered indicator definition (descriptors only).
   */
  @Get('indicators')
  @ApiOkResponse({
    type: IndicatorDefinitionDto,
    isArray: true,
    description: 'Every registered indicator definition.',
  })
  list(): IndicatorDefinition[] {
    return this.registry.list();
  }

  /**
   * `GET /indicators/:key` → one indicator definition by key. **404** when the
   * key is unknown.
   */
  @Get('indicators/:key')
  @ApiOkResponse({ type: IndicatorDefinitionDto, description: 'The indicator definition.' })
  get(@Param() params: IndicatorKeyParamDto): IndicatorDefinition {
    const module = this.registry.get(params.key);
    if (!module) {
      throw new IndicatorNotFoundError(`indicator not found: ${params.key}`);
    }
    return module.definition;
  }

  /**
   * `GET /symbols/:id/indicators/:key?period=…&…` → compute the indicator over
   * the symbol's stored candles. The indicator's own scalar inputs ride as
   * additional query params alongside the required `period` and the optional
   * `from`/`to` epoch-ms bounds; they pass through as strings and the domain
   * validates + coerces them against the indicator's descriptors (an invalid
   * value surfaces as an `IndicatorError` → 400).
   *
   * The open-ended input set is why the query binds as a raw record rather than
   * a whitelisted DTO — the global pipe would otherwise reject any input key it
   * has no field for (`additionalProperties: true` in the old TypeBox schema).
   */
  @Get('symbols/:id/indicators/:key')
  @ApiOkResponse({
    type: IndicatorComputeResultDto,
    description: 'The computed state series over the symbol’s stored candles.',
  })
  @ApiQuery({ name: 'period', enum: Period, required: true, description: 'The period to read.' })
  @ApiQuery({
    name: 'from',
    required: false,
    type: Number,
    description: 'Inclusive lower bound (epoch ms).',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: Number,
    description: 'Exclusive upper bound (epoch ms).',
  })
  computeForSymbol(
    @Param() params: SymbolIndicatorParamsDto,
    @Query() query: Record<string, string>,
  ): Promise<IndicatorComputeResult> {
    const { period, from, to, ...inputs } = query;
    return this.indicators.compute(params.id, params.key, inputs, toPeriod(period), {
      from: toBound(from),
      to: toBound(to),
    });
  }
}

/**
 * Narrow a raw query string to a {@link Period}, matching the old schema's
 * required-enum boundary check: a missing or unrecognized value is a 400
 * (`IndicatorError`), so a bogus period never silently reads an empty series.
 */
function toPeriod(value: string | undefined): Period {
  if (value === undefined || !(Object.values(Period) as string[]).includes(value)) {
    throw new IndicatorError(`invalid period: ${value ?? ''}`);
  }
  return value as Period;
}

/**
 * Coerce an optional epoch-ms bound from its raw query string, matching the old
 * schema's numeric boundary check: a present-but-non-numeric value is a 400
 * (`IndicatorError`); an absent one is left open.
 */
function toBound(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const bound = Number(value);
  if (Number.isNaN(bound)) {
    throw new IndicatorError(`invalid range bound: ${value}`);
  }
  return bound;
}
