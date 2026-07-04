import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Path params carrying a rule id — mirrors the old TypeBox `RuleIdParamSchema`.
 */
export class RuleIdParamDto {
  /**
   * The rule id.
   */
  @ApiProperty()
  @IsString()
  id!: string;
}
