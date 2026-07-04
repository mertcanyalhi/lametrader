import { type Rule, type RuleEventEntry } from '@lametrader/core';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RuleError } from '../domain/rule.js';
import { SymbolIdParamDto } from '../symbols/dto/symbol-id-param.dto.js';
import { RuleDto } from './dto/rule.dto.js';
import { RuleCreateDto } from './dto/rule-create.dto.js';
import { RuleEventEntryDto } from './dto/rule-event-entry.dto.js';
import { RuleEventsQueryDto } from './dto/rule-events-query.dto.js';
import { RuleIdParamDto } from './dto/rule-id-param.dto.js';
import { RuleListQueryDto } from './dto/rule-list-query.dto.js';
import { RulePatchDto } from './dto/rule-patch.dto.js';
import { SymbolRuleEventsQueryDto } from './dto/symbol-rule-events-query.dto.js';
import { RuleService } from './rule.service.js';

/**
 * The RESTful `/rules` resource, reproducing the old Fastify `rulesController`
 * exactly (route table, verbs, status codes, and rule + rule-event payload
 * shapes).
 *
 * One controller owns the CRUD routes under `/rules` plus the two event-log read
 * surfaces the chart drives under `/symbols/:id/rule-events[/count]`:
 *
 * - `GET /rules` — list (filterable by `profileId` / `symbolId` / `enabled`).
 * - `POST /rules` — create (**201**); an unwatched-scope tick-cadence rule
 *   surfaces as {@link import('@lametrader/core').TickRuleNotEligibleError} → 400
 *   with one `fields[]` entry per unwatched symbol (the global exception filter).
 * - `GET /rules/:id` — get (**404** when absent).
 * - `PATCH /rules/:id` — partial merge + re-validate (**200** / 400 / 404).
 * - `DELETE /rules/:id` — delete (**204** / 404).
 * - `GET /rules/:id/events` — one rule's mirrored events log (newest-first).
 * - `GET /symbols/:id/rule-events` — one symbol's mirrored events log, optionally
 *   `chartStates`-filtered.
 * - `GET /symbols/:id/rule-events/count` — that symbol's mirrored event count.
 *
 * Cross-field / domain validation lives in {@link RuleService} and surfaces as
 * its own 400 / 404 via the global exception filter; the boundary DTOs pin the
 * structural contract.
 */
@ApiTags('rules')
@Controller()
export class RulesController {
  /**
   * @param rules - the rules use-case to drive.
   */
  constructor(private readonly rules: RuleService) {}

  /**
   * `GET /rules` → every rule, filtered by `profileId` / `symbolId` / `enabled`,
   * sorted by `order`.
   */
  @Get('rules')
  @ApiOkResponse({ type: RuleDto, isArray: true, description: 'The matching rules.' })
  list(@Query() query: RuleListQueryDto): Promise<Rule[]> {
    return this.rules.list(query);
  }

  /**
   * `POST /rules` → create a rule. Returns **201** with the created rule.
   */
  @Post('rules')
  @ApiCreatedResponse({ type: RuleDto, description: 'The created rule.' })
  create(@Body() body: RuleCreateDto): Promise<Rule> {
    return this.rules.create(body);
  }

  /**
   * `GET /rules/:id` → one rule by id. **404** when absent.
   */
  @Get('rules/:id')
  @ApiOkResponse({ type: RuleDto, description: 'The rule.' })
  get(@Param() params: RuleIdParamDto): Promise<Rule> {
    return this.rules.get(params.id);
  }

  /**
   * `PATCH /rules/:id` → partial merge, re-validated. **404** when absent.
   */
  @Patch('rules/:id')
  @ApiOkResponse({ type: RuleDto, description: 'The updated rule.' })
  patch(@Param() params: RuleIdParamDto, @Body() body: RulePatchDto): Promise<Rule> {
    // The validation pipe materialises every declared DTO field, so absent keys
    // arrive as `undefined` own-properties; pruning them keeps the service's
    // merge (`{ ...existing, ...partial }`) from clobbering unchanged fields
    // with `undefined` — matching the old plain-object patch body.
    return this.rules.patch(params.id, pruneUndefined(body));
  }

  /**
   * `DELETE /rules/:id` → delete. **204** with no body; **404** when absent.
   */
  @Delete('rules/:id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The rule was deleted.' })
  async remove(@Param() params: RuleIdParamDto): Promise<void> {
    await this.rules.remove(params.id);
  }

  /**
   * `GET /rules/:id/events` → one rule's mirrored events log, newest-first,
   * paginated. **404** when the rule is absent.
   */
  @Get('rules/:id/events')
  @ApiOkResponse({ type: RuleEventEntryDto, isArray: true, description: 'The rule events log.' })
  listEvents(
    @Param() params: RuleIdParamDto,
    @Query() query: RuleEventsQueryDto,
  ): Promise<RuleEventEntry[]> {
    return this.rules.listEvents(params.id, query);
  }

  /**
   * `GET /symbols/:id/rule-events` → one symbol's mirrored events log,
   * newest-first, paginated, optionally `chartStates`-filtered.
   */
  @Get('symbols/:id/rule-events')
  @ApiOkResponse({ type: RuleEventEntryDto, isArray: true, description: 'The symbol events log.' })
  listSymbolEvents(
    @Param() params: SymbolIdParamDto,
    @Query() query: SymbolRuleEventsQueryDto,
  ): Promise<RuleEventEntry[]> {
    const { chartStates, ...listOptions } = query;
    return this.rules.listSymbolEvents(params.id, {
      ...listOptions,
      chartStates: parseChartStatesFilter(chartStates),
    });
  }

  /**
   * `GET /symbols/:id/rule-events/count` → the mirrored event count for a symbol.
   */
  @Get('symbols/:id/rule-events/count')
  @ApiOkResponse({ description: 'The mirrored event count.', schema: { type: 'object' } })
  async countSymbolEvents(@Param() params: SymbolIdParamDto): Promise<{ count: number }> {
    return { count: await this.rules.countSymbolEvents(params.id) };
  }
}

/**
 * Return a shallow copy of `source` with every `undefined`-valued key dropped.
 *
 * The validation pipe hydrates a DTO instance whose absent optional fields are
 * present as `undefined` own-properties; a `PATCH` merge must treat those as "not
 * supplied" (a sparse partial), not as "set to undefined".
 */
function pruneUndefined<T extends object>(source: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(source) as (keyof T)[]) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/**
 * Parse the optional `chartStates` query param — a JSON-encoded array of state
 * keys — into the service's `string[] | undefined` filter.
 *
 * Absent ⇒ `undefined` (the read stays unfiltered). Present ⇒ the decoded keys,
 * with an empty array preserved so a blank profile renders no markers.
 *
 * @throws {@link RuleError} when the value is not a JSON array of strings; the
 *   global exception filter maps it to HTTP 400 (the same envelope as a schema
 *   failure).
 */
function parseChartStatesFilter(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new RuleError('chartStates must be a JSON-encoded array of state keys');
  }
  if (!Array.isArray(decoded) || decoded.some((key) => typeof key !== 'string')) {
    throw new RuleError('chartStates must be a JSON-encoded array of state keys');
  }
  return decoded as string[];
}
