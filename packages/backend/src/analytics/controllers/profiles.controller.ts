import type { IndicatorInstance, Profile } from '@lametrader/core';
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
  Put,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IndicatorInstanceDto } from '../dto/indicator-instance.dto.js';
import { IndicatorInstanceInputDto } from '../dto/indicator-instance-input.dto.js';
import { ProfileDto } from '../dto/profile.dto.js';
import { ProfileIdParamDto } from '../dto/profile-id-param.dto.js';
import { ProfileIndicatorParamsDto } from '../dto/profile-indicator-params.dto.js';
import { ProfileInputDto } from '../dto/profile-input.dto.js';
import { ProfilePatchDto } from '../dto/profile-patch.dto.js';
import { ProfileService } from '../services/profile.service.js';

/**
 * The RESTful `/profiles` surface over the {@link ProfileService}: profile CRUD
 * plus the attached-indicators sub-resource.
 *
 * - `GET /profiles` — list.
 * - `POST /profiles` — create (**201**).
 * - `GET /profiles/:id` — get one (200 / 404).
 * - `PUT /profiles/:id` — replace (200 / 400 / 404 / 409).
 * - `PATCH /profiles/:id` — partial update (200 / 400 / 404 / 409).
 * - `DELETE /profiles/:id` — delete (**204** / 404).
 * - `GET|POST /profiles/:id/indicators` — list / attach (**201** on attach).
 * - `GET|PUT|DELETE /profiles/:id/indicators/:instanceId` — get / replace / detach (**204** on detach).
 *
 * DTOs validate input at the boundary and pin the OpenAPI contract; domain
 * failures (`ProfileError` / `IndicatorError` → 400, `ProfileNotFoundError` /
 * `IndicatorInstanceNotFoundError` → 404, `ProfileConflictError` → 409) are mapped
 * by the global exception filter.
 */
@ApiTags('profiles')
@Controller('profiles')
export class ProfilesController {
  /**
   * @param profiles - the profiles use-case to drive.
   */
  constructor(private readonly profiles: ProfileService) {}

  /**
   * `GET /profiles` → list all profiles.
   */
  @Get()
  @ApiOkResponse({ type: ProfileDto, isArray: true, description: 'All profiles.' })
  list(): Promise<Profile[]> {
    return this.profiles.list();
  }

  /**
   * `POST /profiles` → create a profile. Returns **201** with the created profile.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ProfileDto, description: 'The created profile.' })
  create(@Body() body: ProfileInputDto): Promise<Profile> {
    return this.profiles.create(body);
  }

  /**
   * `GET /profiles/:id` → get one profile.
   */
  @Get(':id')
  @ApiOkResponse({ type: ProfileDto, description: 'The profile.' })
  get(@Param() params: ProfileIdParamDto): Promise<Profile> {
    return this.profiles.get(params.id);
  }

  /**
   * `PUT /profiles/:id` → fully replace a profile's mutable fields.
   */
  @Put(':id')
  @ApiOkResponse({ type: ProfileDto, description: 'The replaced profile.' })
  replace(@Param() params: ProfileIdParamDto, @Body() body: ProfileInputDto): Promise<Profile> {
    return this.profiles.replace(params.id, body);
  }

  /**
   * `PATCH /profiles/:id` → partially update a profile.
   */
  @Patch(':id')
  @ApiOkResponse({ type: ProfileDto, description: 'The updated profile.' })
  update(@Param() params: ProfileIdParamDto, @Body() body: ProfilePatchDto): Promise<Profile> {
    return this.profiles.update(params.id, body);
  }

  /**
   * `DELETE /profiles/:id` → delete a profile. **204**.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The profile was deleted.' })
  remove(@Param() params: ProfileIdParamDto): Promise<void> {
    return this.profiles.remove(params.id);
  }

  /**
   * `GET /profiles/:id/indicators` → list the profile's attached indicators.
   */
  @Get(':id/indicators')
  @ApiOkResponse({ type: IndicatorInstanceDto, isArray: true, description: 'Attached indicators.' })
  listIndicators(@Param() params: ProfileIdParamDto): Promise<IndicatorInstance[]> {
    return this.profiles.listIndicators(params.id);
  }

  /**
   * `POST /profiles/:id/indicators` → attach an indicator. Returns **201**.
   */
  @Post(':id/indicators')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: IndicatorInstanceDto, description: 'The attached instance.' })
  addIndicator(
    @Param() params: ProfileIdParamDto,
    @Body() body: IndicatorInstanceInputDto,
  ): Promise<IndicatorInstance> {
    return this.profiles.addIndicator(params.id, body);
  }

  /**
   * `GET /profiles/:id/indicators/:instanceId` → get one attached instance.
   */
  @Get(':id/indicators/:instanceId')
  @ApiOkResponse({ type: IndicatorInstanceDto, description: 'The attached instance.' })
  getIndicator(@Param() params: ProfileIndicatorParamsDto): Promise<IndicatorInstance> {
    return this.profiles.getIndicator(params.id, params.instanceId);
  }

  /**
   * `PUT /profiles/:id/indicators/:instanceId` → replace an attached instance.
   */
  @Put(':id/indicators/:instanceId')
  @ApiOkResponse({ type: IndicatorInstanceDto, description: 'The replaced instance.' })
  replaceIndicator(
    @Param() params: ProfileIndicatorParamsDto,
    @Body() body: IndicatorInstanceInputDto,
  ): Promise<IndicatorInstance> {
    return this.profiles.replaceIndicator(params.id, params.instanceId, body);
  }

  /**
   * `DELETE /profiles/:id/indicators/:instanceId` → detach an instance. **204**.
   */
  @Delete(':id/indicators/:instanceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The instance was detached.' })
  removeIndicator(@Param() params: ProfileIndicatorParamsDto): Promise<void> {
    return this.profiles.removeIndicator(params.id, params.instanceId);
  }
}
