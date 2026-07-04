import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

/**
 * A rule's expiration object `{ at }` — mirrors the non-null branch of the old
 * TypeBox `ExpirationSchema`.
 *
 * The full `expiration` field on {@link import('./rule-create.dto.js').RuleCreateDto}
 * is `ExpirationDto | null` (never-expires); `null` is carried on the create/patch
 * DTOs directly.
 */
export class ExpirationDto {
  /**
   * When the rule stops firing (epoch ms).
   */
  @ApiProperty()
  @IsNumber()
  at!: number;
}
