import {
  type StateRepository,
  type StateValue,
  SymbolNotFoundError,
  type WatchlistRepository,
} from '@lametrader/core';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { SymbolIdParamDto } from '../symbols/dto/symbol-id-param.dto.js';
import { WATCHLIST_REPOSITORY } from '../watchlist/watchlist-repository.token.js';
import { ProfileStateParamDto } from './dto/profile-state-param.dto.js';
import { StateHistoryEntryDto } from './dto/state-history-entry.dto.js';
import { StateKeyDescriptorDto } from './dto/state-key-descriptor.dto.js';
import { StateSeriesParamsDto } from './dto/state-series-params.dto.js';
import { StateSeriesQueryDto } from './dto/state-series-query.dto.js';
import { StateValueDto } from './dto/state-value.dto.js';
import { SymbolStateQueryDto } from './dto/symbol-state-query.dto.js';
import { StateHistoryService } from './state-history.service.js';
import type { StateHistoryEntry, StateKeyDescriptor } from './state-history.service.types.js';
import { STATE_REPOSITORY } from './state-repository.token.js';

/**
 * The RESTful read-side rule-engine state surface, reproducing the old Fastify
 * `stateController` + the state routes of `symbolsController` exactly.
 *
 * State is partitioned by profile (#281, ADR-0014), so the two per-profile reads
 * carry a `profileId` — the global map as a profile sub-resource, the per-symbol
 * map as a required query. The chart state-overlay routes (#434) are watchlist-
 * scoped and NOT profile-partitioned (`RuleEventEntry` carries no `profileId`).
 * One controller owns routes under both the `/profiles/:profileId/state` and
 * `/symbols/:id/state` prefixes:
 *
 * - `GET /profiles/:profileId/state/global` — the profile's global state map.
 * - `GET /symbols/:id/state?profileId=` — the symbol's state map for a profile.
 * - `GET /symbols/:id/state-keys` — the symbol's known state-key catalog.
 * - `GET /symbols/:id/state/:key/series` — one key's time-series for the symbol.
 *
 * The three `/symbols/:id/…` reads require the symbol to be watched (a `.get`
 * against the shared {@link WatchlistRepository}); an unwatched id surfaces as a
 * {@link SymbolNotFoundError} → 404 via the global exception filter, matching the
 * old `SymbolService.listSymbolState` / `assertSymbolWatched` guard. The global
 * read does not validate the profile exists (an unknown profile returns `{}`,
 * parity with the old controller).
 */
@ApiTags('state')
@ApiExtraModels(StateValueDto)
@Controller()
export class StateController {
  /**
   * @param state - the rule-engine state store (read-side).
   * @param watchlist - the shared watchlist store, for the watched-symbol guard.
   * @param stateHistory - the chart state-overlay read use-case.
   */
  constructor(
    @Inject(STATE_REPOSITORY) private readonly state: StateRepository,
    @Inject(WATCHLIST_REPOSITORY) private readonly watchlist: WatchlistRepository,
    private readonly stateHistory: StateHistoryService,
  ) {}

  /**
   * `GET /profiles/:profileId/state/global` → the profile's current global state
   * map (`{ [key]: StateValue }`; `{}` when empty).
   */
  @Get('profiles/:profileId/state/global')
  @ApiOkResponse({
    description: 'The profile’s current global state map.',
    schema: { type: 'object', additionalProperties: { $ref: getSchemaPath(StateValueDto) } },
  })
  listGlobalState(@Param() params: ProfileStateParamDto): Promise<Record<string, StateValue>> {
    return this.state.listGlobalState(params.profileId);
  }

  /**
   * `GET /symbols/:id/state?profileId=` → the symbol's current state map for a
   * profile. **404** when the symbol is not watched.
   */
  @Get('symbols/:id/state')
  @ApiOkResponse({
    description: 'The symbol’s current state map for the profile.',
    schema: { type: 'object', additionalProperties: { $ref: getSchemaPath(StateValueDto) } },
  })
  async listSymbolState(
    @Param() params: SymbolIdParamDto,
    @Query() query: SymbolStateQueryDto,
  ): Promise<Record<string, StateValue>> {
    await this.assertWatched(params.id);
    return this.state.listSymbolState(query.profileId, params.id);
  }

  /**
   * `GET /symbols/:id/state-keys` → the alphabetical catalog of every state key
   * the symbol has been written under. **404** when the symbol is not watched.
   */
  @Get('symbols/:id/state-keys')
  @ApiOkResponse({ type: StateKeyDescriptorDto, isArray: true, description: 'Known state keys.' })
  async stateKeys(@Param() params: SymbolIdParamDto): Promise<StateKeyDescriptor[]> {
    await this.assertWatched(params.id);
    return this.stateHistory.listKeys(params.id);
  }

  /**
   * `GET /symbols/:id/state/:key/series` → one state key's time-series for the
   * symbol, ascending by `ts`. **404** when the symbol is not watched.
   */
  @Get('symbols/:id/state/:key/series')
  @ApiOkResponse({ type: StateHistoryEntryDto, isArray: true, description: 'The key time-series.' })
  async series(
    @Param() params: StateSeriesParamsDto,
    @Query() query: StateSeriesQueryDto,
  ): Promise<StateHistoryEntry[]> {
    await this.assertWatched(params.id);
    return this.stateHistory.series(params.id, params.key, { from: query.from, to: query.to });
  }

  /**
   * Throw {@link SymbolNotFoundError} when `id` is not on the watchlist.
   *
   * Keeps the symbol-scoped state reads in lockstep with the rest of the symbol
   * surface — the same 404 envelope the old `SymbolService.listSymbolState` /
   * `assertSymbolWatched` produced (`symbol not watched: <id>`).
   */
  private async assertWatched(id: string): Promise<void> {
    const watched = await this.watchlist.get(id);
    if (watched === null) {
      throw new SymbolNotFoundError(`symbol not watched: ${id}`);
    }
  }
}
