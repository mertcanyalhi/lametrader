import type { Config } from '@lametrader/core';
import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from './config.service.js';
import { ConfigDto } from './dto/config.dto.js';
import { ConfigPatchDto } from './dto/config-patch.dto.js';

/**
 * The RESTful `/config` resource over the {@link ConfigService}.
 *
 * DTOs validate input at the boundary and pin the OpenAPI contract; cross-field
 * / domain rules (e.g. `defaultPeriod ∈ periods`) are enforced by the domain
 * and surface as 400s via the global exception filter.
 */
@ApiTags('config')
@Controller('config')
export class ConfigController {
  /**
   * @param config - the configuration use-case to drive.
   */
  constructor(private readonly config: ConfigService) {}

  /**
   * `GET /config` → the current config (or the default when nothing is stored).
   */
  @Get()
  @ApiOkResponse({ type: ConfigDto, description: 'The current config.' })
  get(): Promise<Config> {
    return this.config.get();
  }

  /**
   * `PUT /config` → fully replace the config.
   */
  @Put()
  @ApiOkResponse({ type: ConfigDto, description: 'The replaced config.' })
  replace(@Body() body: ConfigDto): Promise<Config> {
    return this.config.replace(body);
  }

  /**
   * `PATCH /config` → partially merge over the current config.
   */
  @Patch()
  @ApiOkResponse({ type: ConfigDto, description: 'The updated config.' })
  patch(@Body() body: ConfigPatchDto): Promise<Config> {
    return this.config.patch(body);
  }
}
