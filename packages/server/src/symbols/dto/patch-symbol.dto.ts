import { Period } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum } from 'class-validator';

/**
 * The `PATCH /symbols/:id` request body — mirrors the old TypeBox
 * `PatchSymbolSchema`.
 *
 * `periods` is required (each a supported {@link Period}); the domain enforces
 * `periods ⊆ config.periods` and the source's capability, surfacing a
 * `{ error }` 400 on a violation.
 */
export class PatchSymbolDto {
  /**
   * The replacement periods for the symbol.
   */
  @ApiProperty({ enum: Period, isArray: true, description: 'Replacement per-symbol periods.' })
  @IsArray()
  @IsEnum(Period, { each: true })
  periods!: Period[];
}
