import { ApiProperty } from '@nestjs/swagger';
import { IndicatorInstanceDto } from './indicator-instance.dto.js';
import { ProfileScopeDto } from './profile-scope.dto.js';

/**
 * The `200`/`201` response shape of a full profile — mirrors the old TypeBox
 * `ProfileSchema`.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class ProfileDto {
  /** Generated, stable id. */
  @ApiProperty()
  id!: string;

  /** Human-readable, unique name. */
  @ApiProperty()
  name!: string;

  /** Free-text description. */
  @ApiProperty()
  description!: string;

  /** Whether the profile is active. */
  @ApiProperty()
  enabled!: boolean;

  /** Which watched symbols the profile applies to. */
  @ApiProperty({ type: ProfileScopeDto })
  scope!: ProfileScopeDto;

  /** Creation time, epoch milliseconds. */
  @ApiProperty()
  createdAt!: number;

  /** Last-update time, epoch milliseconds. */
  @ApiProperty()
  updatedAt!: number;

  /** Attached indicator instances, in attachment order. */
  @ApiProperty({ type: IndicatorInstanceDto, isArray: true })
  indicators!: IndicatorInstanceDto[];
}
