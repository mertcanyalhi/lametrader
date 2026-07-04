import { Period } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum } from 'class-validator';

/**
 * A full configuration — the `PUT /config` request body and the `200` response
 * shape for every config route.
 *
 * Boundary validation pins only the *field-level* contract (each entry is a
 * supported {@link Period}; no unknown properties). The cross-field rules —
 * non-empty `periods`, `defaultPeriod ∈ periods` — are the domain's job and
 * surface as a `{ error }` 400 from `ConfigService`, exactly as before.
 */
export class ConfigDto {
  /**
   * The supported periods, in declared order.
   */
  @ApiProperty({
    enum: Period,
    isArray: true,
    description: 'Supported periods, in declared order.',
  })
  @IsArray()
  @IsEnum(Period, { each: true })
  periods!: Period[];

  /**
   * The period shown for a symbol by default; must be one of {@link ConfigDto.periods}.
   */
  @ApiProperty({ enum: Period, description: 'Default period; must be one of `periods`.' })
  @IsEnum(Period)
  defaultPeriod!: Period;
}
