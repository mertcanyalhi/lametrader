import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * The path params carrying a profile id, for the `/profiles/:id` routes —
 * mirrors the old TypeBox `ProfileIdParamSchema`.
 */
export class ProfileIdParamDto {
  /**
   * The profile id.
   */
  @ApiProperty({ description: 'Profile id.' })
  @IsString()
  id!: string;
}
