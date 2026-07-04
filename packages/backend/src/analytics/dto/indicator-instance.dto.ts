import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The response shape of an attached indicator instance — the configured inputs,
 * the definition `version` recorded at attach time, an optional `label`, and a
 * derived `summary` added on read.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class IndicatorInstanceDto {
  /** Generated, stable instance id. */
  @ApiProperty()
  id!: string;

  /** Which indicator definition (key) from the catalog. */
  @ApiProperty()
  indicatorKey!: string;

  /** Definition version the inputs were validated against. */
  @ApiProperty()
  version!: number;

  /** Validated input values keyed by descriptor key. */
  @ApiProperty({ type: Object })
  inputs!: Record<string, unknown>;

  /** Optional alias. */
  @ApiPropertyOptional()
  label?: string;

  /** Derived display summary (e.g. `"SMA 14 close"`), added by the service on read. */
  @ApiPropertyOptional()
  summary?: string;
}
