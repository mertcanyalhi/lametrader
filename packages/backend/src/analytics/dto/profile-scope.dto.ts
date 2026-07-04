import { ProfileScope } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * A profile's scope — a discriminator `type` (`all` | `symbols`) and, for a
 * `symbols` scope, the explicit `symbolIds`.
 *
 * Modeled as a single object (not a union) exactly like the old TypeBox
 * `ProfileScopeSchema`. Field-level validation pins `type` to a {@link ProfileScope}
 * value; the cross-field rules — `symbolIds` only matters for a `symbols` scope,
 * an empty subset normalizes to `all`, and every id must be watched — are the
 * domain's job (`parseProfileScope` / `assertScopeWatched`) and surface as a
 * `{ error }` 400.
 */
export class ProfileScopeDto {
  /**
   * Whether the profile applies to every watched symbol (`all`) or an explicit
   * subset (`symbols`).
   */
  @ApiProperty({ enum: ProfileScope, description: 'Scope discriminator.' })
  @IsEnum(ProfileScope)
  type!: ProfileScope;

  /**
   * The watched symbol ids a `symbols` scope applies to (ignored for `all`).
   */
  @ApiPropertyOptional({ type: String, isArray: true, description: 'Watched symbol ids.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symbolIds?: string[];
}
