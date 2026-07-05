import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ProfileScopeDto } from './profile-scope.dto.js';

/**
 * The `PATCH /profiles/:id` (partial update) request body — mirrors the old
 * TypeBox `ProfilePatchSchema`.
 *
 * Every field is optional; omitted fields keep their current value (the domain's
 * `mergeProfileFields` fills them from the stored profile). Present fields carry
 * the same field-level validation as {@link ProfileInputDto}; the merged result's
 * domain rules surface as `{ error }` 400 / 409.
 */
export class ProfilePatchDto {
  /**
   * Replacement name, when changing it.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  /**
   * Replacement description, when changing it.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Replacement enabled flag, when changing it.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * Replacement scope, when changing it.
   */
  @ApiPropertyOptional({ type: ProfileScopeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileScopeDto)
  scope?: ProfileScopeDto;
}
