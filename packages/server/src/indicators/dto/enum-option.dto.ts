import { ApiProperty } from '@nestjs/swagger';

/**
 * One option in an enum descriptor's closed set — mirrors the old TypeBox
 * `EnumOptionSchema`.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class EnumOptionDto {
  /** The value used in the input/state object. */
  @ApiProperty({ description: 'The value used in inputs/state.' })
  value!: string;

  /** Human-readable label for UI option lists. */
  @ApiProperty({ description: 'Human-readable label.' })
  label!: string;
}
