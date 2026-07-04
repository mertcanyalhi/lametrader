import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * The path params carrying a profile id + indicator-instance id, for the
 * `/profiles/:id/indicators/:instanceId` routes — mirrors the old TypeBox
 * `ProfileIndicatorParamsSchema`.
 */
export class ProfileIndicatorParamsDto {
  /**
   * The profile id.
   */
  @ApiProperty({ description: 'Profile id.' })
  @IsString()
  id!: string;

  /**
   * The attached indicator-instance id.
   */
  @ApiProperty({ description: 'Attached indicator-instance id.' })
  @IsString()
  instanceId!: string;
}
