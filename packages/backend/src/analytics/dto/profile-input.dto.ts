import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ProfileScopeDto } from './profile-scope.dto.js';

/**
 * The `POST /profiles` (create) and `PUT /profiles/:id` (replace) request body —
 * mirrors the old TypeBox `ProfileInputSchema`.
 *
 * Only `name` is required; the rest default in the domain (`description` `''`,
 * `enabled` `true`, `scope` `all`). Boundary validation pins the field-level
 * contract (correct types, no unknown properties); the domain rules (non-blank
 * name, unique name, scope ids watched) are enforced by `ProfileService` and
 * surface as `{ error }` 400 / 409.
 */
export class ProfileInputDto {
  /**
   * Human-readable, unique name.
   */
  @ApiProperty({ description: 'Human-readable, unique name.' })
  @IsString()
  name!: string;

  /**
   * Free-text description; defaults to `''` in the domain.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Whether the profile is active; defaults to `true` in the domain.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * Which watched symbols the profile applies to; defaults to `all` in the domain.
   */
  @ApiPropertyOptional({ type: ProfileScopeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileScopeDto)
  scope?: ProfileScopeDto;
}
