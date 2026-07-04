import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Query parameters for `GET /rules` — mirrors the old TypeBox
 * `RuleListQuerySchema`. Each filter is independent and optional; setting all
 * three ANDs them.
 */
export class RuleListQueryDto {
  /**
   * Keep only rules with this `profileId`.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  profileId?: string;

  /**
   * Keep only rules whose scope admits this `symbolId`.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  symbolId?: string;

  /**
   * Keep only rules whose `enabled` flag matches (coerced from the query string).
   */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  enabled?: boolean;
}
