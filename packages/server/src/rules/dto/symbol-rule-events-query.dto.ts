import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { RuleEventsQueryDto } from './rule-events-query.dto.js';

/**
 * Query parameters for `GET /symbols/:id/rule-events` — the windowed event read
 * backing the chart's markers. Mirrors the old TypeBox `SymbolRuleEventsQuerySchema`.
 *
 * Extends {@link RuleEventsQueryDto}'s `limit` / `before` / `from` / `to` with an
 * optional `chartStates` filter: a JSON-encoded array of state keys (e.g.
 * `["price:trend"]`). A single JSON string carries the whole set because a
 * repeated query param cannot distinguish an **empty** array (present ⇒ render
 * nothing) from an **absent** one (⇒ unfiltered) — a distinction the chart
 * requires. The controller parses it and passes `chartStates` to the service;
 * a malformed value is a `RuleError` → 400.
 */
export class SymbolRuleEventsQueryDto extends RuleEventsQueryDto {
  /**
   * A JSON-encoded array of state keys to keep (`stateSet` / `stateRemoved` only);
   * absent leaves the read unfiltered.
   */
  @ApiPropertyOptional({ type: String, description: 'JSON-encoded array of state keys.' })
  @IsOptional()
  @IsString()
  chartStates?: string;
}
