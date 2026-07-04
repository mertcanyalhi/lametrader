import { FieldType, PriceSource } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EnumOptionDto } from './enum-option.dto.js';

/**
 * A numeric input descriptor — mirrors the old TypeBox `NumberFieldSchema`
 * (core `NumberFieldDescriptor`).
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class NumberInputFieldDto {
  /** Discriminator: numeric input. */
  @ApiProperty({ enum: [FieldType.Number] })
  type!: FieldType.Number;

  /** Stable key used in the input object. */
  @ApiProperty()
  key!: string;

  /** Human-readable label for UI forms. */
  @ApiProperty()
  label!: string;

  /** One-line explanation shown in UI info popovers. */
  @ApiPropertyOptional()
  description?: string;

  /** When true, the value must be an integer. */
  @ApiPropertyOptional()
  integer?: boolean;

  /** Inclusive lower bound. */
  @ApiPropertyOptional()
  min?: number;

  /** Inclusive upper bound. */
  @ApiPropertyOptional()
  max?: number;

  /** UI step hint (form rendering only). */
  @ApiPropertyOptional()
  step?: number;

  /** Default applied when the value is omitted. */
  @ApiPropertyOptional()
  default?: number;
}

/**
 * A price-source input descriptor — mirrors the old TypeBox `SourceFieldSchema`
 * (core `SourceFieldDescriptor`).
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class SourceInputFieldDto {
  /** Discriminator: price-source input. */
  @ApiProperty({ enum: [FieldType.Source] })
  type!: FieldType.Source;

  /** Stable key. */
  @ApiProperty()
  key!: string;

  /** Human-readable label for UI forms. */
  @ApiProperty()
  label!: string;

  /** One-line explanation shown in UI info popovers. */
  @ApiPropertyOptional()
  description?: string;

  /** Default selector applied when omitted (typically `close`). */
  @ApiPropertyOptional({ enum: PriceSource })
  default?: PriceSource;
}

/**
 * An enum input descriptor — mirrors the old TypeBox `EnumFieldSchema`
 * (core `EnumFieldDescriptor`).
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class EnumInputFieldDto {
  /** Discriminator: enum input. */
  @ApiProperty({ enum: [FieldType.Enum] })
  type!: FieldType.Enum;

  /** Stable key. */
  @ApiProperty()
  key!: string;

  /** Human-readable label for UI forms. */
  @ApiProperty()
  label!: string;

  /** One-line explanation shown in UI info popovers. */
  @ApiPropertyOptional()
  description?: string;

  /** The closed set of allowed options. */
  @ApiProperty({ type: EnumOptionDto, isArray: true })
  options!: EnumOptionDto[];

  /** Default applied when the value is omitted; must be one of `options`. */
  @ApiPropertyOptional()
  default?: string;
}
